import { useState } from "react";
import { useNow } from "./data";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Trash2,
  Pencil,
  Plus,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { foodGroups, expiryLabel } from "./model";
import type { Food, Language } from "./model";
import { categories, categoryLabel, foodName } from "./words";
import { FavoriteToggle } from "./FavoriteToggle";
import { useFavorites, lineAction } from "./line-data";
import { useConfirm } from "./components/confirmation";
import { Sheet } from "./Sheet";
function daysLeft(expiry: string, nowS: number): number {
  const today = new Date((nowS + 7 * 3600) * 1000).toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(expiry + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) /
      86400000,
  );
}
function status(food: Food, nowS: number) {
  const days = daysLeft(food.expiry, nowS);
  return !Number.isFinite(days)
    ? "unknown"
    : days < 0
      ? "expired"
      : days <= 2
        ? "soon"
        : "fresh";
}
const thumb: Record<string, string> = {
  Dairy: "🥛",
  Produce: "🥬",
  Meat: "🥩",
  Seafood: "🐟",
  Beverage: "🥤",
  Condiments: "🧂",
  Leftovers: "🍱",
  Bakery: "🍞",
  Snacks: "🍪",
  Other: "🥣",
};
function foodKey(...parts: string[]) {
  return JSON.stringify(
    parts.map((part) => part.trim().normalize("NFKC").toLowerCase()),
  );
}
function expiryText(food: Food, now: number, language: Language) {
  const th = language === "th";
  const state = status(food, now);
  if (state === "expired") return th ? "หมดอายุแล้ว" : "Expired";
  if (state === "unknown") return th ? "ไม่ทราบวันหมดอายุ" : "Expiry unknown";
  if (daysLeft(food.expiry, now) === 0)
    return th ? "หมดอายุวันนี้" : "Expires today";
  return th
    ? `หมดอายุ ${expiryLabel(food.expiry, language)}`
    : `Expires ${expiryLabel(food.expiry, language)}`;
}
function useInventory({
  fridgeId,
  items,
  language,
  onChanged,
}: {
  fridgeId: string;
  items: Food[];
  language: Language;
  onChanged: () => void;
}) {
  const th = language === "th";
  const now = useNow();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("expiry");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useFavorites(fridgeId);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [patch, setPatch] = useState({
    name_th: "",
    name_en: "",
    estimated_expiry_date: "",
    category: "",
  });
  const confirm = useConfirm();
  const term = search.trim().normalize("NFKC").toLowerCase();
  const favoriteCategories = new Set(favorites.data?.categories);
  const favoriteFoods = new Set(
    favorites.data?.items.map((item) =>
      foodKey(item.name_th, item.name_en, item.category),
    ),
  );
  const visible = items.filter(
    (food) =>
      (!term ||
        `${food.nameTh} ${food.nameEn}`
          .normalize("NFKC")
          .toLowerCase()
          .includes(term)) &&
      (!category || food.category === category) &&
      (filter === "all" || status(food, now) === filter) &&
      (!favoritesOnly ||
        favoriteCategories.has(food.category) ||
        favoriteFoods.has(foodKey(food.nameTh, food.nameEn, food.category))),
  );
  const groups = foodGroups(visible).sort((a, b) =>
    sort === "name"
      ? foodName(a[0]!, language).localeCompare(
          foodName(b[0]!, language),
          language,
        )
      : sort === "fresh"
        ? b[0]!.expiry.localeCompare(a[0]!.expiry)
        : a[0]!.expiry.localeCompare(b[0]!.expiry),
  );
  const chosen = items.filter((food) => selected.has(food.id));
  function toggleGroup(group: Food[]) {
    const all = group.every((food) => selected.has(food.id));
    setSelected((previous) => {
      const next = new Set(previous);
      for (const food of group) {
        if (all) next.delete(food.id);
        else next.add(food.id);
      }
      return next;
    });
  }
  async function mutateItems(
    method: "DELETE" | "PATCH",
    body?: Record<string, string>,
  ) {
    if (busy || !chosen.length) return;
    setBusy(true);
    const succeeded = new Set<string>();
    try {
      for (let start = 0; start < chosen.length; start += 5) {
        const batch = await Promise.allSettled(
          chosen.slice(start, start + 5).map(async (food) => {
            await lineAction(
              `/api/fridges/${encodeURIComponent(fridgeId)}/inventory/${encodeURIComponent(food.id)}`,
              method,
              body,
            );
            return food.id;
          }),
        );
        for (const result of batch)
          if (result.status === "fulfilled") succeeded.add(result.value);
      }
      setSelected(
        (previous) => new Set([...previous].filter((id) => !succeeded.has(id))),
      );
      onChanged();
      void favorites.mutate().catch(() => {});
      setEditing(false);
      if (succeeded.size === chosen.length)
        toast.success(
          th
            ? `${method === "DELETE" ? "นำออก" : "อัปเดต"} ${succeeded.size} ชิ้นแล้ว`
            : `${succeeded.size} items ${method === "DELETE" ? "removed" : "updated"}`,
        );
      else
        toast.error(
          th
            ? `สำเร็จ ${succeeded.size} จาก ${chosen.length} ชิ้น กรุณาลองรายการที่เหลืออีกครั้ง`
            : `${succeeded.size} of ${chosen.length} succeeded. Retry remaining items.`,
        );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      await confirm(
        th
          ? `นำอาหารที่เลือก ${chosen.length} ชิ้นออกจากตู้เย็น?`
          : `Remove ${chosen.length} selected pieces?`,
        th ? "นำออก" : "Take out",
      )
    )
      await mutateItems("DELETE");
  }
  async function edit(event: FormEvent) {
    event.preventDefault();
    const body = Object.fromEntries(
      Object.entries(patch)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [key, value.trim()]),
    );
    if (!Object.keys(body).length) {
      toast.error(th ? "กรอกอย่างน้อยหนึ่งช่อง" : "Change at least one field");
      return;
    }
    await mutateItems("PATCH", body);
  }
  return {
    th,
    now,
    fridgeId,
    items,
    language,
    search,
    setSearch,
    category,
    setCategory,
    filter,
    setFilter,
    sort,
    setSort,
    favoritesOnly,
    setFavoritesOnly,
    selecting,
    setSelecting,
    selected,
    setSelected,
    busy,
    editing,
    setEditing,
    patch,
    setPatch,
    visible,
    groups,
    chosen,
    toggleGroup,
    remove,
    edit,
  };
}
type InventoryView = ReturnType<typeof useInventory>;
function InventorySummary({ view }: { view: InventoryView }) {
  const { th, now, items, filter, setFilter } = view;
  const summary = [
    ["all", th ? "ทั้งหมด" : "All"],
    ["fresh", th ? "ยังสด" : "Fresh"],
    ["soon", th ? "ควรทานเร็ว ๆ นี้" : "Eat soon"],
    ["expired", th ? "หมดอายุ" : "Expired"],
  ];

  return (
    <>
      <div className="inventory-summary">
        {summary.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`stock-stat stock-${key}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key!)}
          >
            <span>{label}</span>
            <strong>
              {key === "all"
                ? items.length
                : items.filter((food) => status(food, now) === key).length}
            </strong>
            <span className="small">{th ? "ชิ้น" : "pieces"}</span>
          </button>
        ))}
      </div>
    </>
  );
}
function InventoryToolbar({ view }: { view: InventoryView }) {
  const { th, fridgeId, selecting, setSelecting, setSelected } = view;
  return (
    <>
      <div className="section-head">
        <div>
          <h2 id="food-title">{th ? "อาหารในตู้เย็น" : "Food in the fridge"}</h2>
          <p className="small">
            {th
              ? "ทานรายการบนสุดก่อน ตามวันหมดอายุ"
              : "Eat the food at the top first."}
          </p>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            <CheckSquare size={18} aria-hidden="true" />
            {selecting ? (th ? "เสร็จ" : "Done") : th ? "เลือก" : "Select"}
          </button>
          <Link
            className="primary"
            to={`/fridges/${encodeURIComponent(fridgeId)}/food/add`}
          >
            <Plus size={18} aria-hidden="true" />
            {th ? "เพิ่มอาหาร" : "Add food"}
          </Link>
        </div>
      </div>
      <InventoryFilters view={view} />
    </>
  );
}
function InventoryFilters({ view }: { view: InventoryView }) {
  const { language } = view;
  const {
    th,
    search,
    setSearch,
    category,
    setCategory,
    sort,
    setSort,
    favoritesOnly,
    setFavoritesOnly,
  } = view;
  return (
    <div className="inventory-filters">
      <label className="food-search">
        <Search size={19} aria-hidden="true" />
        <span className="sr-only">{th ? "ค้นหาอาหาร" : "Search food"}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={th ? "ค้นหาอาหาร…" : "Search food…"}
        />
      </label>
      <label>
        <span className="sr-only">{th ? "หมวดอาหาร" : "Food type"}</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{th ? "ทุกหมวด" : "All types"}</option>
          {Object.keys(categories).map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value, language)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        aria-pressed={favoritesOnly}
        onClick={() => setFavoritesOnly(!favoritesOnly)}
      >
        {th ? "ของโปรด" : "Favorites"}
      </button>
      <label>
        <SlidersHorizontal size={17} aria-hidden="true" />
        <span className="sr-only">{th ? "เรียงลำดับ" : "Sort"}</span>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="expiry">
            {th ? "หมดอายุก่อน → หลัง" : "Expired → fresh"}
          </option>
          <option value="fresh">
            {th ? "หมดอายุหลัง → ก่อน" : "Fresh → expired"}
          </option>
          <option value="name">{th ? "เรียงตามชื่อ" : "Name A–Z"}</option>
        </select>
      </label>
    </div>
  );
}
function InventoryContents({ view }: { view: InventoryView }) {
  const { th, selecting, setSelected, visible, groups } = view;
  return (
    <>
      {selecting && (
        <button
          type="button"
          className="secondary"
          onClick={() => setSelected(new Set(visible.map((food) => food.id)))}
        >
          {th ? "เลือกอาหารที่แสดงทั้งหมด" : "Select all visible food"}
        </button>
      )}
      {!groups.length ? (
        <EmptyInventory view={view} />
      ) : (
        <ul className="food-list prototype-food-list">
          {groups.map((group) => (
            <FoodGroupRow key={group[0]!.id} group={group} view={view} />
          ))}
        </ul>
      )}
    </>
  );
}
function FoodGroupRow({ group, view }: { group: Food[]; view: InventoryView }) {
  const { th, now, fridgeId, language, selecting, selected, toggleGroup } =
    view;
  const food = group[0]!;
  const state = status(food, now);
  return (
    <li key={food.id} className={`food-row food-${state}`}>
      {selecting && (
        <label className="food-check">
          <input
            type="checkbox"
            checked={group.every((item) => selected.has(item.id))}
            onChange={() => toggleGroup(group)}
            aria-label={(th ? "เลือก " : "Select ") + foodName(food, language)}
          />
        </label>
      )}
      <Link
        to={`/fridges/${encodeURIComponent(fridgeId)}/food/${encodeURIComponent(food.id)}`}
      >
        <div className="inventory-thumb">
          <span aria-hidden="true">{thumb[food.category] ?? "🥣"}</span>
          {food.hasPhoto && (
            <img
              src={`/api/fridges/${encodeURIComponent(fridgeId)}/inventory/${encodeURIComponent(food.id)}/photo`}
              loading="lazy"
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
        </div>
        <div className="food-row-copy">
          <strong>{foodName(food, language)}</strong>
          <span className="small">
            {categoryLabel(food.category, language)} · × {group.length}
          </span>
          <span className={`expiry-pill expiry-${state}`}>
            {expiryText(food, now, language)}
          </span>
        </div>
      </Link>
      <FavoriteToggle food={food} fridgeId={fridgeId} language={language} />
    </li>
  );
}
function InventorySelection({ view }: { view: InventoryView }) {
  const { th, selecting, busy, setEditing, setPatch, chosen, remove } = view;
  return (
    <>
      {chosen.length > 0 && selecting && (
        <div
          className="selection-bar"
          role="region"
          aria-label={th ? "จัดการอาหารที่เลือก" : "Selected food actions"}
        >
          <strong>
            {th ? `เลือก ${chosen.length} ชิ้น` : `${chosen.length} selected`}
          </strong>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPatch({
                name_th: "",
                name_en: "",
                estimated_expiry_date: "",
                category: "",
              });
              setEditing(true);
            }}
          >
            <Pencil size={17} aria-hidden="true" />
            {th ? "แก้ไข" : "Edit"}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 size={17} aria-hidden="true" />
            {th ? "นำออก" : "Take out"}
          </button>
        </div>
      )}
    </>
  );
}
function BulkEditSheet({ view }: { view: InventoryView }) {
  const {
    th,
    language,
    busy,
    editing,
    setEditing,
    patch,
    setPatch,
    chosen,
    edit,
  } = view;
  return (
    <>
      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title={
          th ? `แก้ไขอาหาร ${chosen.length} ชิ้น` : `Edit ${chosen.length} pieces`
        }
      >
        <form onSubmit={(event) => void edit(event)} className="add-form">
          <p>
            {th
              ? "กรอกเฉพาะข้อมูลที่ต้องการเปลี่ยน ช่องที่เว้นว่างจะคงค่าเดิม"
              : "Fill in only what should change. Leave a field empty to keep its value."}
          </p>
          <fieldset disabled={busy}>
            {(["name_th", "name_en", "estimated_expiry_date"] as const).map(
              (key) => (
                <label key={key}>
                  {key === "name_th"
                    ? th
                      ? "ชื่อไทย"
                      : "Thai name"
                    : key === "name_en"
                      ? th
                        ? "ชื่ออังกฤษ"
                        : "English name"
                      : th
                        ? "วันหมดอายุ"
                        : "Expiry date"}
                  <input
                    type={key === "estimated_expiry_date" ? "date" : "text"}
                    value={patch[key]}
                    maxLength={120}
                    onChange={(e) =>
                      setPatch({ ...patch, [key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
            <label>
              {th ? "หมวดอาหาร" : "Food type"}
              <select
                value={patch.category}
                onChange={(e) =>
                  setPatch({ ...patch, category: e.target.value })
                }
              >
                <option value="">{th ? "คงเดิม" : "Keep as is"}</option>
                {Object.keys(categories).map((value) => (
                  <option key={value} value={value}>
                    {categoryLabel(value, language)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary">
              {busy ? (th ? "กำลังบันทึก…" : "Saving…") : th ? "บันทึก" : "Save"}
            </button>
          </fieldset>
        </form>
      </Sheet>
    </>
  );
}
export function Inventory(props: Parameters<typeof useInventory>[0]) {
  const view = useInventory(props);
  return (
    <section className="inventory-section" aria-labelledby="food-title">
      <InventorySummary view={view} />
      <InventoryToolbar view={view} />
      <InventoryContents view={view} />
      <InventorySelection view={view} />
      <BulkEditSheet view={view} />
    </section>
  );
}

function EmptyInventory({ view }: { view: InventoryView }) {
  const { th, items } = view;
  return (
    <div className="surface empty-state">
      <h3>
        {items.length
          ? th
            ? "ไม่มีอาหารตรงกับตัวกรอง"
            : "No food matches these filters"
          : th
            ? "ตู้เย็นยังว่างอยู่"
            : "Your fridge is empty"}
      </h3>
      <p>
        {items.length
          ? th
            ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง"
            : "Try another search or filter."
          : th
            ? "เพิ่มอาหารด้วยปุ่มด้านบน หรือใช้กล้องหน้าตู้เย็นเมื่ออุปกรณ์พร้อม"
            : "Add food above, or use the fridge camera when your devices are ready."}
      </p>
    </div>
  );
}
