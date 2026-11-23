import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Trash2,
  Pencil,
  Plus,
  Square,
  Star,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useNow } from "./data";
import { expiryLabel } from "./model";
import type { Food, Language } from "./model";
import { categories, categoryLabel, foodName } from "./words";
import { FavoriteToggle } from "./FavoriteToggle";
import { useFavorites, lineAction } from "./line-data";
import { useConfirm } from "./components/confirmation";
import { Button } from "./components/ui/button";
import { Sheet } from "./Sheet";
import {
  buildFavoriteShelves,
  filterAndSortInventory,
  foodIdentityKey,
  foodStatus,
  relativeExpiryText,
  summarizeInventory,
} from "./state/dashboard-machine";
import type {
  InventoryFilter,
  InventorySort,
} from "./state/dashboard-machine";

const THUMB_EMOJI: Record<string, string> = {
  Dairy: "🥛",
  Produce: "🥬",
  Meat: "🥩",
  Seafood: "🦐",
  Beverage: "🧃",
  Condiments: "🧂",
  Leftovers: "🍱",
  Bakery: "🍞",
  Snacks: "🍪",
  Other: "📦",
};

function statusPillLabel(
  state: ReturnType<typeof foodStatus>,
  language: Language,
): string {
  const th = language === "th";
  if (state === "expired") return th ? "หมดอายุ" : "Expired";
  if (state === "soon") return th ? "รีบทาน" : "Eat soon";
  if (state === "fresh") return th ? "ยังสด" : "Fresh";
  return th ? "ไม่ระบุ" : "Unknown";
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
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [sort, setSort] = useState<InventorySort>("expiry");
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

  const favoriteCategories = new Set(favorites.data?.categories);
  const favoriteFoods = new Set(
    favorites.data?.items.map((item) =>
      foodIdentityKey(item.name_th, item.name_en, item.category),
    ),
  );

  const summaryCounts = summarizeInventory(items, now);
  const { visible, groups } = filterAndSortInventory(items, {
    search,
    category,
    filter,
    sort,
    favoritesOnly,
    favoriteCategories,
    favoriteFoodKeys: favoriteFoods,
    nowS: now,
    language,
  });

  const shelves = favoritesOnly
    ? buildFavoriteShelves(items, favorites.data, now)
    : [];
  const chosen = items.filter((food) => selected.has(food.id));
  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(category) ||
    filter !== "all" ||
    favoritesOnly;

  function resetFilters() {
    setSearch("");
    setCategory("");
    setFilter("all");
    setFavoritesOnly(false);
  }

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

  async function toggleFavoriteCategory(cat: string) {
    if (busy || !favorites.data) return;
    setBusy(true);
    try {
      const next = new Set(favorites.data.categories);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      await lineAction(
        `/api/fridges/${encodeURIComponent(fridgeId)}/favorites/categories`,
        "PUT",
        { categories: [...next] },
      );
      await favorites.mutate();
    } catch {
      toast.error(th ? "บันทึกหมวดโปรดไม่สำเร็จ" : "Could not update category favorite");
    } finally {
      setBusy(false);
    }
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
        for (const result of batch) {
          if (result.status === "fulfilled") succeeded.add(result.value);
        }
      }
      setSelected(
        (previous) => new Set([...previous].filter((id) => !succeeded.has(id))),
      );
      onChanged();
      void favorites.mutate().catch(() => {});
      setEditing(false);
      if (succeeded.size === chosen.length) {
        toast.success(
          th
            ? `${method === "DELETE" ? "นำออก" : "อัปเดต"} ${succeeded.size} ชิ้นแล้ว`
            : `${succeeded.size} items ${method === "DELETE" ? "removed" : "updated"}`,
        );
      } else {
        toast.error(
          th
            ? `สำเร็จ ${succeeded.size} จาก ${chosen.length} ชิ้น กรุณาลองรายการที่เหลืออีกครั้ง`
            : `${succeeded.size} of ${chosen.length} succeeded. Retry remaining items.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function takeOutSingle(food: Food) {
    if (busy) return;
    const label = foodName(food, language);
    if (
      !(await confirm(
        th ? `นำ "${label}" ออกจากตู้เย็น?` : `Take "${label}" out of the fridge?`,
        th ? "นำออก" : "Take out",
        "take",
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await lineAction(
        `/api/fridges/${encodeURIComponent(fridgeId)}/inventory/${encodeURIComponent(food.id)}`,
        "DELETE",
      );
      onChanged();
      void favorites.mutate().catch(() => {});
      toast.success(th ? `นำ "${label}" ออกแล้ว` : `Took out "${label}"`, {
        duration: 6000,
        action: {
          label: th ? "เลิกทำ" : "Undo",
          onClick: () => {
            void fetch(
              `/api/fridges/${encodeURIComponent(fridgeId)}/inventory`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  item_id: crypto.randomUUID(),
                  name: food.nameEn || food.nameTh || label,
                  estimated_expiry_date: food.expiry,
                  category: Object.hasOwn(categories, food.category)
                    ? food.category
                    : "Other",
                  jpeg_base64: null,
                }),
              },
            )
              .then((res) => {
                if (!res.ok) throw new Error("Undo failed");
                onChanged();
                toast.success(th ? `คืน "${label}" กลับแล้ว` : `Restored "${label}"`);
              })
              .catch(() => {
                toast.error(th ? "เลิกทำไม่สำเร็จ" : "Could not undo");
              });
          },
        },
      });
    } catch {
      toast.error(th ? "นำออกไม่สำเร็จ ลองอีกครั้ง" : "Could not take out item");
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
        "take",
      )
    ) {
      await mutateItems("DELETE");
    }
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
    favorites,
    shelves,
    selecting,
    setSelecting,
    selected,
    setSelected,
    busy,
    editing,
    setEditing,
    patch,
    setPatch,
    summaryCounts,
    visible,
    groups,
    chosen,
    hasActiveFilters,
    resetFilters,
    toggleGroup,
    toggleFavoriteCategory,
    takeOutSingle,
    remove,
    edit,
  };
}

type InventoryView = ReturnType<typeof useInventory>;

function InventorySummary({ view }: { view: InventoryView }) {
  const { th, summaryCounts, filter, setFilter } = view;
  const summary: Array<[InventoryFilter, string, number]> = [
    ["all", th ? "ทั้งหมด" : "All", summaryCounts.total],
    ["fresh", th ? "ยังสด" : "Fresh", summaryCounts.fresh],
    ["soon", th ? "ควรทานเร็ว ๆ นี้" : "Eat soon", summaryCounts.soon],
    ["expired", th ? "หมดอายุ" : "Expired", summaryCounts.expired],
  ];

  return (
    <div className="inventory-summary">
      {summary.map(([key, label, count]) => (
        <button
          type="button"
          key={key}
          className={`stock-stat stock-${key}`}
          aria-pressed={filter === key}
          onClick={() => setFilter(key)}
        >
          <span>{label}</span>
          <strong className="num">{count}</strong>

        </button>
      ))}
    </div>
  );
}

function InventoryToolbar({ view }: { view: InventoryView }) {
  const { th, fridgeId, selecting, setSelecting, setSelected, items } = view;
  return (
    <>
      <div className="page-head">
        <div className="page-head-copy">
          <h2 id="food-title" className="inv-title">
            {th ? "อาหารในตู้เย็น" : "Food in the fridge"}
          </h2>
        </div>
        <div className="inv-acts">
          {items.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
              }}
            >
              {!selecting && <Square size={18} aria-hidden="true" />}
              {selecting ? (th ? "เสร็จ" : "Done") : th ? "เลือก" : "Select"}
            </button>
          )}
          <Link
            className="primary"
            to={`/fridges/${encodeURIComponent(fridgeId)}/food/add`}
          >
            <Plus size={18} aria-hidden="true" />
            {th ? "เพิ่มอาหาร" : "Add food"}
          </Link>
        </div>
      </div>
      {items.length > 0 && (
        <>
          <InventorySummary view={view} />
          <InventoryFilters view={view} />
        </>
      )}
    </>
  );
}

function InventoryFilters({ view }: { view: InventoryView }) {
  const {
    language,
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
    <div className="flex flex-col gap-2.5">
      <label className="search-pill">
        <Search size={19} aria-hidden="true" />
        <span className="sr-only">{th ? "ค้นหาอาหาร" : "Search food"}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={th ? "ค้นหาอาหาร…" : "Search food…"}
        />
      </label>
      <div className="filters">
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
          className="chip fav-chip"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
        >
          <Star
            size={16}
            fill={favoritesOnly ? "currentColor" : "none"}
            aria-hidden="true"
          />
          {th ? "ของโปรด" : "Favorites"}
        </button>
        <label className="flex items-center gap-1.5">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span className="sr-only">{th ? "เรียงลำดับ" : "Sort"}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as InventorySort)}
          >
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
    </div>
  );
}

function FavoritesShelves({ view }: { view: InventoryView }) {
  const { th, now, fridgeId, language, shelves, toggleFavoriteCategory } = view;
  if (!shelves.length) return null;
  return (
    <div className="favwrap">
      {shelves.map((group) => (
        <section key={group.category} className="fgroup">
          <div className="fg-h">
            <div className="fg-title">
              <span className="fg-e" aria-hidden="true">
                {THUMB_EMOJI[group.category] ?? "📦"}
              </span>
              <span>{categoryLabel(group.category, language)}</span>
              <span className="fg-c">{group.entries.length}</span>
            </div>
            <button
              type="button"
              className="chip"
              aria-pressed={group.categoryStarred}
              onClick={() => void toggleFavoriteCategory(group.category)}
            >
              <Star
                size={14}
                fill={group.categoryStarred ? "currentColor" : "none"}
                aria-hidden="true"
              />
              {th ? "ทั้งหมวด" : "Whole type"}
            </button>
          </div>
          <div className="shelf">
            {group.entries.map((entry) => {
              const title = entry.food
                ? foodName(entry.food, language)
                : th
                  ? entry.favorite?.name_th || entry.favorite?.name_en || "—"
                  : entry.favorite?.name_en || entry.favorite?.name_th || "—";
              const targetUrl = entry.food
                ? `/fridges/${encodeURIComponent(fridgeId)}/food/${encodeURIComponent(entry.food.id)}`
                : `/fridges/${encodeURIComponent(fridgeId)}/food/add`;

              return (
                <Link
                  key={entry.key}
                  to={targetUrl}
                  className={`tile${entry.inStock ? "" : " gone"}`}
                >
                  <div className="tile-img">
                    <span aria-hidden="true">
                      {THUMB_EMOJI[group.category] ?? "📦"}
                    </span>
                    {entry.food?.hasPhoto && (
                      <img
                        src={`/api/fridges/${encodeURIComponent(fridgeId)}/inventory/${encodeURIComponent(entry.food.id)}/photo`}
                        loading="lazy"
                        alt=""
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    )}
                    {entry.count > 1 && (
                      <span className="qty-badge">×{entry.count}</span>
                    )}
                  </div>
                  <span className="tile-n">{title}</span>
                  <span
                    className={`pill ${entry.inStock ? entry.status : "neutral"}`}
                  >
                    {entry.food
                      ? relativeExpiryText(entry.food, now, language)
                      : th
                        ? "หมดสต็อก"
                        : "Out"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function InventoryContents({ view }: { view: InventoryView }) {
  const {
    th,
    selecting,
    setSelected,
    visible,
    groups,
    favoritesOnly,
    search,
    shelves,
  } = view;
  const showShelves =
    favoritesOnly && !selecting && !search.trim() && shelves.length > 0;

  return (
    <>
      {selecting && (
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => setSelected(new Set(visible.map((food) => food.id)))}
          >
            {th ? "เลือกอาหารที่แสดงทั้งหมด" : "Select all visible food"}
          </button>
        </div>
      )}
      {showShelves ? (
        <FavoritesShelves view={view} />
      ) : !groups.length ? (
        <EmptyInventory view={view} />
      ) : (
        <ul className="inv-list">
          {groups.map((group) => (
            <FoodGroupRow key={group[0]!.id} group={group} view={view} />
          ))}
        </ul>
      )}
    </>
  );
}

function FoodGroupRow({ group, view }: { group: Food[]; view: InventoryView }) {
  const {
    th,
    now,
    fridgeId,
    language,
    selecting,
    selected,
    busy,
    toggleGroup,
    takeOutSingle,
  } = view;
  const food = group[0]!;
  const state = foodStatus(food, now);
  const isSelected = group.every((item) => selected.has(item.id));
  const detailUrl = `/fridges/${encodeURIComponent(fridgeId)}/food/${encodeURIComponent(food.id)}`;
  const relText = relativeExpiryText(food, now, language);

  return (
    <li className={`item${selecting && isSelected ? " is-sel" : ""}`}>
      {selecting && (
        <label className="food-check">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleGroup(group)}
            aria-label={(th ? "เลือก " : "Select ") + foodName(food, language)}
          />
        </label>
      )}
      {!selecting && (
        <FavoriteToggle food={food} fridgeId={fridgeId} language={language} />
      )}
      <Link className="item-open" to={detailUrl}>
        <div className="thumb">
          <span aria-hidden="true">{THUMB_EMOJI[food.category] ?? "📦"}</span>
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
          {group.length > 1 && <span className="qty-badge">×{group.length}</span>}
        </div>
        <div className="item-txt">
          <span className="item-name">
            <span className="nm-t">{foodName(food, language)}</span>
            {group.length > 1 && <span className="x">×{group.length}</span>}
          </span>
          <span className="item-cat">{categoryLabel(food.category, language)}</span>
          <span className={`pill ${state} item-st-inline`}>{relText}</span>
        </div>
        <div className="item-exp">
          <span className={`pill ${state}`}>{statusPillLabel(state, language)}</span>
          <span className="rel">
            {relText} · {expiryLabel(food.expiry, language)}
          </span>
        </div>
      </Link>
      {!selecting && (
        <div className="item-btns">
          <Link
            to={detailUrl}
            className="ibtn edit"
            aria-label={(th ? "แก้ไข " : "Edit ") + foodName(food, language)}
            title={th ? "รายละเอียด / แก้ไข" : "Details / Edit"}
          >
            <Pencil size={18} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="ibtn take"
            disabled={busy}
            aria-label={(th ? "นำออก: " : "Take out: ") + foodName(food, language)}
            title={th ? "นำออกจากตู้" : "Take out"}
            onClick={() => void takeOutSingle(food)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

function InventorySelection({ view }: { view: InventoryView }) {
  const { th, selecting, busy, setEditing, setPatch, chosen, remove } = view;
  if (!chosen.length || !selecting) return null;
  return (
    <section
      className="selbar"
      aria-label={th ? "จัดการอาหารที่เลือก" : "Selected food actions"}
    >
      <strong className="cnt">
        {th ? `เลือก ${chosen.length} ชิ้น` : `${chosen.length} selected`}
      </strong>
      <button
        type="button"
        className="btn lime sm"
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
        <Pencil size={16} aria-hidden="true" />
        {th ? "แก้ไข" : "Edit"}
      </button>
      <button
        type="button"
        className="take-solid sm"
        disabled={busy}
        onClick={() => void remove()}
      >
        <Trash2 size={16} aria-hidden="true" />
        {th ? "นำออก" : "Take out"}
      </button>
    </section>
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
    <Sheet
      open={editing}
      onOpenChange={setEditing}
      title={
        th ? `แก้ไขอาหาร ${chosen.length} ชิ้น` : `Edit ${chosen.length} pieces`
      }
    >
      <form onSubmit={(event) => void edit(event)} className="add-form">
        <p className="sub">
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
                  onChange={(e) => setPatch({ ...patch, [key]: e.target.value })}
                />
              </label>
            ),
          )}
          <label>
            {th ? "หมวดอาหาร" : "Food type"}
            <select
              value={patch.category}
              onChange={(e) => setPatch({ ...patch, category: e.target.value })}
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
  );
}

export function Inventory(props: Parameters<typeof useInventory>[0]) {
  const view = useInventory(props);
  return (
    <section className="inv" aria-labelledby="food-title">
      <InventoryToolbar view={view} />
      <InventoryContents view={view} />
      <InventorySelection view={view} />
      <BulkEditSheet view={view} />
    </section>
  );
}

function EmptyInventory({ view }: { view: InventoryView }) {
  const { th, items, hasActiveFilters, resetFilters } = view;
  const filteredEmpty = items.length > 0 && hasActiveFilters;
  const heading = filteredEmpty
    ? th
      ? "ไม่มีอาหารตรงกับตัวกรอง"
      : "No food matches these filters"
    : th
      ? "ตู้เย็นยังว่างอยู่"
      : "Your fridge is empty";

  return (
    <div className="empty-state">
      <h3>{heading}</h3>
      {filteredEmpty && (
        <Button type="button" variant="primary" onClick={resetFilters}>
          <RotateCcw size={17} aria-hidden="true" />
          {th ? "ล้างตัวกรอง" : "Reset filters"}
        </Button>
      )}
    </div>
  );
}
