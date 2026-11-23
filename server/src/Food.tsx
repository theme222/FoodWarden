import { ArrowLeft, Camera, Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { useNow } from "./data";
import { expiryLabel, foodGroups, localTimestamp } from "./model";
import type { Food, Language } from "./model";
import { foodStatus, relativeExpiryText } from "./state/dashboard-machine";
import { categories, categoryLabel, foodName, words } from "./words";

const CAT_EMOJIS: Record<string, string> = {
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

function route(fridgeId: string, itemId?: string) {
  return (
    "/fridges/" +
    encodeURIComponent(fridgeId) +
    "/food" +
    (itemId ? "/" + encodeURIComponent(itemId) : "")
  );
}

function inventoryEndpoint(fridgeId: string) {
  return "/api/fridges/" + encodeURIComponent(fridgeId) + "/inventory";
}

function addDaysBangkok(days: number): string {
  return new Date(Date.now() + days * 86_400_000 + 7 * 3600_000)
    .toISOString()
    .slice(0, 10);
}

function FoodPhoto({
  fridgeId,
  food,
  language,
}: {
  fridgeId: string;
  food: Food;
  language: Language;
}) {
  const [failed, setFailed] = useState(false);
  const t = words[language];

  if (!food.hasPhoto) {
    return (
      <div className="d-photo">
        <p className="sub">{t.noPhoto}</p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="d-photo">
        <p className="sub" role="alert">
          {t.photoError}
        </p>
      </div>
    );
  }
  return (
    <div className="d-photo">
      <img
        className="food-photo"
        src={
          inventoryEndpoint(fridgeId) +
          "/" +
          encodeURIComponent(food.id) +
          "/photo"
        }
        alt={foodName(food, language)}
        width={800}
        height={600}
        decoding="async"
        fetchPriority="high"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function FoodMatchingCopies({
  group,
  currentFoodId,
  fridgeId,
  language,
}: {
  group: Food[];
  currentFoodId: string;
  fridgeId: string;
  language: Language;
}) {
  if (group.length <= 1) return null;
  const th = language === "th";
  const t = words[language];
  const cameraLabel = th ? "กล้อง C0" : "Camera C0";
  const manualLabel = th ? "เพิ่มเอง" : "Manual";

  return (
    <div className="subblock">
      <p className="small">{t.matching}</p>
      <ul className="copies">
        {group.map((item, index) => {
          const sourceText =
            item.checkInSource === "CAMERA" ? cameraLabel : manualLabel;
          return (
            <li key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className={item.id === currentFoodId ? "primary sm" : "btn sm"}
                  to={route(fridgeId, item.id)}
                  aria-current={item.id === currentFoodId ? "page" : undefined}
                >
                  {t.itemNumber} {index + 1}
                </Link>
                {item.checkInSource && (
                  <span className="pill neutral">{sourceText}</span>
                )}
                {typeof item.confidence === "number" && (
                  <span className="small num">
                    {Math.round(item.confidence * 100)}%
                  </span>
                )}
              </div>
              {item.checkInTimestampS ? (
                <span className="small">
                  {localTimestamp(item.checkInTimestampS, language)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FoodEditForm({
  food,
  language,
  busy,
  onSave,
}: {
  food: Food;
  language: Language;
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const t = words[language];
  const defaultCategory = Object.hasOwn(categories, food.category)
    ? food.category
    : "Other";

  return (
    <form className="subblock add-form" onSubmit={onSave}>
      <fieldset disabled={busy}>
        <label>
          {t.nameEn}
          <input
            name="name_en"
            defaultValue={food.nameEn}
            required
            maxLength={100}
          />
        </label>
        <label>
          {t.nameTh}
          <input
            name="name_th"
            defaultValue={food.nameTh}
            required
            maxLength={100}
          />
        </label>
        <label>
          {t.expiry}
          <input
            name="expiry"
            type="date"
            defaultValue={food.expiry}
            required
          />
        </label>
        <label>
          {t.category}
          <select name="category" defaultValue={defaultCategory}>
            {Object.keys(categories).map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category, language)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="form-actions">
        <button className="primary" disabled={busy} type="submit">
          {busy ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}

function readFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

interface FoodDetailProps {
  itemId: string;
  items: Food[];
  fridgeId: string;
  language: Language;
  onChanged: () => void;
}

export function FoodDetail(props: FoodDetailProps) {
  return (
    <FoodDetailEditor
      key={JSON.stringify([props.fridgeId, props.itemId])}
      {...props}
    />
  );
}

function restoreRemovedFood(
  fridgeId: string,
  food: Food,
  removedLabel: string,
  th: boolean,
  onChanged: () => void,
) {
  void fetch(inventoryEndpoint(fridgeId), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item_id: crypto.randomUUID(),
      name: food.nameEn || food.nameTh || removedLabel,
      estimated_expiry_date: food.expiry,
      category: Object.hasOwn(categories, food.category)
        ? food.category
        : "Other",
      jpeg_base64: null,
    }),
  })
    .then((r) => {
      if (!r.ok) throw new Error("Undo failed");
      onChanged();
    })
    .catch(() => {
      toast.error(th ? "เลิกทำไม่สำเร็จ" : "Could not undo");
    });
}

function FoodMissingNotice({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const th = language === "th";
  const t = words[language];
  return (
    <section className="food-detail panel">
      <output className="sub">{t.itemMissing}</output>
      <div>
        <Link
          className="primary"
          to={"/fridges/" + encodeURIComponent(fridgeId)}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {th ? "กลับไปหน้ารายการอาหาร" : "Back to food list"}
        </Link>
      </div>
    </section>
  );
}

function FoodDetailHeader({
  fridgeId,
  food,
  language,
  notice,
  error,
  onDismissError,
}: {
  fridgeId: string;
  food: Food;
  language: Language;
  notice: string | null;
  error: string | null;
  onDismissError: () => void;
}) {
  const th = language === "th";
  return (
    <>
      <div className="page-head">
        <div className="page-head-copy">
          <Link
            className="btn sm"
            to={"/fridges/" + encodeURIComponent(fridgeId)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {th ? "กลับ" : "Back"}
          </Link>
          <h1>{foodName(food, language)}</h1>
        </div>
        <span className="pill neutral">
          {CAT_EMOJIS[food.category] ?? "📦"}{" "}
          {categoryLabel(food.category, language) || "—"}
        </span>
      </div>

      {notice && <output className="pill accent">{notice}</output>}
      {error && (
        <StatusAlert
          action={
            <button type="button" className="btn sm" onClick={onDismissError}>
              {th ? "ปิด" : "Dismiss"}
            </button>
          }
        >
          {error}
        </StatusAlert>
      )}
    </>
  );
}

function FoodExpirySummary({
  food,
  groupSize,
  now,
  language,
}: {
  food: Food;
  groupSize: number;
  now: number;
  language: Language;
}) {
  const th = language === "th";
  const t = words[language];
  const status = foodStatus(food, now);
  const relText = relativeExpiryText(food, now, language);
  const advice = th
    ? food.adviceTh || food.adviceEn
    : food.adviceEn || food.adviceTh;

  return (
    <>
      <div className={`d-exp ${status}`}>
        <div>
          <strong>{relText}</strong>
          <p className="small">
            {t.expiry}: {expiryLabel(food.expiry, language)}
          </p>
        </div>
        <span className={`pill ${status}`}>
          {t.duplicates}: {groupSize - 1}
        </span>
      </div>

      {advice && (
        <div className="subblock">
          <h3>{th ? "คำแนะนำการเก็บรักษา" : "Storage tip"}</h3>
          <p>{advice}</p>
        </div>
      )}
    </>
  );
}

function FoodDetailEditor({
  itemId,
  items,
  fridgeId,
  language,
  onChanged,
}: FoodDetailProps) {
  const th = language === "th";
  const t = words[language];
  const now = useNow();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = useConfirm();
  const group = foodGroups(items).find((entries) =>
    entries.some((entry) => entry.id === itemId),
  );
  const food = group?.find((entry) => entry.id === itemId);

  if (!group || !food) {
    return <FoodMissingNotice fridgeId={fridgeId} language={language} />;
  }

  const targetFood = food;
  const itemUrl =
    inventoryEndpoint(fridgeId) + "/" + encodeURIComponent(targetFood.id);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const nameEn = readFormString(form, "name_en");
    const nameTh = readFormString(form, "name_th");
    const expiry = readFormString(form, "expiry");
    const category = readFormString(form, "category") || "Other";

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(itemUrl, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(nameEn ? { name_en: nameEn } : {}),
          ...(nameTh ? { name_th: nameTh } : {}),
          estimated_expiry_date: expiry,
          category,
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      onChanged();
      setEditing(false);
      setNotice(t.itemUpdated);
      toast.success(t.itemUpdated);
    } catch {
      setError(t.saveError);
      toast.error(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem() {
    if (busy) return;
    if (!(await confirm(t.confirmDeleteFood, t.deleteFood, "take"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(itemUrl, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Delete failed");
      onChanged();
      const removedLabel = foodName(targetFood, language);
      toast.success(t.deleteFood, {
        duration: 6000,
        action: {
          label: th ? "เลิกทำ" : "Undo",
          onClick: () =>
            restoreRemovedFood(
              fridgeId,
              targetFood,
              removedLabel,
              th,
              onChanged,
            ),
        },
      });
      void navigate("/fridges/" + encodeURIComponent(fridgeId), {
        replace: true,
      });
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="food-detail panel">
      <FoodDetailHeader
        fridgeId={fridgeId}
        food={targetFood}
        language={language}
        notice={notice}
        error={error}
        onDismissError={() => setError(null)}
      />

      <FoodPhoto
        key={JSON.stringify([fridgeId, targetFood.id, targetFood.hasPhoto])}
        fridgeId={fridgeId}
        food={targetFood}
        language={language}
      />

      <FoodExpirySummary
        food={targetFood}
        groupSize={group.length}
        now={now}
        language={language}
      />

      <FoodMatchingCopies
        group={group}
        currentFoodId={targetFood.id}
        fridgeId={fridgeId}
        language={language}
      />

      <div className="form-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setEditing((prev) => !prev);
            setError(null);
          }}
        >
          <Pencil size={17} aria-hidden="true" />
          {editing ? t.cancel : t.editFood}
        </button>
        <button
          type="button"
          className="take-solid"
          disabled={busy}
          onClick={() => void removeItem()}
        >
          <Trash2 size={17} aria-hidden="true" />
          {t.deleteFood}
        </button>
      </div>

      {editing && (
        <FoodEditForm
          food={targetFood}
          language={language}
          busy={busy}
          onSave={(event) => void saveEdit(event)}
        />
      )}
    </section>
  );
}

async function prepareJpeg(file: File): Promise<string> {
  if (file.size > 25_000_000) throw new Error("Photo is too large");
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    URL.revokeObjectURL(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  const scale = Math.min(
    1,
    1440 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo processing unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  if (!jpeg || jpeg.length > 2_000_000) throw new Error("Photo is too large");
  return jpeg;
}

function AddFoodCategoryField({
  category,
  language,
  onChange,
}: {
  category: string;
  language: Language;
  onChange: (next: string) => void;
}) {
  const t = words[language];
  return (
    <div className="flex flex-col gap-2">
      <label>
        {t.category}
        <select
          name="category"
          value={category}
          onChange={(e) => onChange(e.target.value)}
        >
          {Object.keys(categories).map((cat) => (
            <option key={cat} value={cat}>
              {categoryLabel(cat, language)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AddFoodPhotoField({
  photo,
  photoBusy,
  language,
  onSelect,
  onClear,
}: {
  photo: string | null;
  photoBusy: boolean;
  language: Language;
  onSelect: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const t = words[language];
  return (
    <div className="photo-box">
      <p className="font-semibold">{t.optionalPhoto}</p>
      {photo && (
        <img
          className="food-preview"
          src={"data:image/jpeg;base64," + photo}
          alt=""
        />
      )}
      <div className="form-actions">
        {([false, true] as const).map((camera) => (
          <label className="primary sm photo-label" key={String(camera)}>
            {camera ? (
              <Camera size={16} aria-hidden="true" />
            ) : (
              <ImageIcon size={16} aria-hidden="true" />
            )}
            {camera ? t.takePhoto : t.pickPhoto}
            <input
              type="file"
              accept="image/*"
              capture={camera ? "environment" : undefined}
              disabled={photoBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                onSelect(file);
              }}
            />
          </label>
        ))}
        {photo && (
          <button type="button" className="btn sm" onClick={onClear}>
            {t.removePhoto}
          </button>
        )}
      </div>
    </div>
  );
}

export function AddFood({
  fridgeId,
  language,
  onAdded,
}: {
  fridgeId: string;
  language: Language;
  onAdded: () => void;
}) {
  const th = language === "th";
  const t = words[language];
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState(() => addDaysBangkok(7));
  const [category, setCategory] = useState("Other");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<"photo" | "save" | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ payload: string; id: string } | null>(null);

  async function selectPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      setPhoto(await prepareJpeg(file));
    } catch {
      setError("photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || photoBusy) return;
    const payload = {
      name: name.trim(),
      estimated_expiry_date: expiry,
      category,
      jpeg_base64: photo,
    };
    const key = JSON.stringify(payload);
    if (attempt.current?.payload !== key) {
      attempt.current = { payload: key, id: crypto.randomUUID() };
    }
    const itemId = attempt.current.id;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(inventoryEndpoint(fridgeId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, ...payload }),
      });
      if (!response.ok) throw new Error("Save failed");
      onAdded();
      toast.success(t.saved);
      void navigate("/fridges/" + encodeURIComponent(fridgeId), {
        replace: true,
        state: { added: true },
      });
    } catch {
      setError("save");
      setSaving(false);
    }
  }

  const presets = [
    [3, th ? "อีก 3 วัน" : "In 3 days"],
    [7, th ? "อีก 7 วัน" : "In 7 days"],
    [14, th ? "อีก 14 วัน" : "In 14 days"],
    [30, th ? "อีก 30 วัน" : "In 30 days"],
  ] as const;


  return (
    <section className="food-detail panel">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{t.addFood}</h1>
          <p className="sub">
            {th
              ? "ตั้งวันหมดอายุเริ่มต้นให้แล้ว สามารถปรับได้ตามฉลาก"
              : "Pre-filled with a 1-week default so check-in takes seconds."}
          </p>
        </div>
      </div>

      <form className="add-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={saving}>
          <label>
            {t.name}
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoComplete="off"
              placeholder={th ? "เช่น นมสด, ไข่ไก่" : "e.g. Milk, Eggs"}
            />
          </label>

          <label>
            {t.expiry}
            <input
              name="expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              required
              aria-describedby="expiry-help"
            />
          </label>
          <fieldset className="quick"><legend className="small">{th ? "วันหมดอายุนับจากวันนี้" : "Expiry from today"}</legend>
            {presets.map(([days, label]) => (
              <button
                key={days}
                type="button"
                className="chip"
                aria-pressed={expiry === addDaysBangkok(days)}
                onClick={() => setExpiry(addDaysBangkok(days))}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <p className="small" id="expiry-help">
            {t.expiryHelp}
          </p>

          <AddFoodCategoryField
            category={category}
            language={language}
            onChange={setCategory}
          />

          <AddFoodPhotoField
            photo={photo}
            photoBusy={photoBusy}
            language={language}
            onSelect={(file) => void selectPhoto(file)}
            onClear={() => setPhoto(null)}
          />
        </fieldset>

        {photoBusy && <output className="small">{t.loading}</output>}
        {error && (
          <StatusAlert
            action={
              error === "photo" ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setPhoto(null);
                    setError(null);
                  }}
                >
                  {th ? "ดำเนินการต่อโดยไม่มีรูป" : "Continue without photo"}
                </button>
              ) : undefined
            }
          >
            {error === "photo" ? t.fileError : t.saveError}
          </StatusAlert>
        )}

        <div className="form-actions">
          <button
            className="primary big"
            disabled={saving || photoBusy}
            type="submit"
          >
            {saving ? t.saving : t.save}
          </button>
          <Link
            className="btn big"
            to={"/fridges/" + encodeURIComponent(fridgeId)}
          >
            {t.cancel}
          </Link>
        </div>
      </form>
    </section>
  );
}
