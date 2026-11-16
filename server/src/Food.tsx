import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { toast } from "sonner";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { expiryLabel, foodGroups } from "./model";
import type { Food, Language } from "./model";
import { categories, categoryLabel, foodName, words } from "./words";

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

  if (!food.hasPhoto) return <p className="photo-placeholder">{t.noPhoto}</p>;
  if (failed) {
    return (
      <p className="photo-placeholder" role="alert">
        {t.photoError}
      </p>
    );
  }
  return (
    <img
      className="food-photo"
      src={
        inventoryEndpoint(fridgeId) +
        "/" +
        encodeURIComponent(food.id) +
        "/photo"
      }
      alt={foodName(food, language)}
      onError={() => setFailed(true)}
    />
  );
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
function FoodDetailEditor({
  itemId,
  items,
  fridgeId,
  language,
  onChanged,
}: FoodDetailProps) {
  const t = words[language];
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = useConfirm();
  const group = foodGroups(items).find((entries) =>
    entries.some((food) => food.id === itemId),
  );
  const food = group?.find((entry) => entry.id === itemId);
  if (!group || !food) return <p role="status">{t.itemMissing}</p>;

  const advice =
    language === "th"
      ? food.adviceTh || food.adviceEn
      : food.adviceEn || food.adviceTh;
  const itemUrl =
    inventoryEndpoint(fridgeId) + "/" + encodeURIComponent(food.id);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !food) return;
    const form = new FormData(event.currentTarget);
    const nameEn = String(form.get("name_en") ?? "").trim();
    const nameTh = String(form.get("name_th") ?? "").trim();
    const expiry = String(form.get("expiry") ?? "");
    const category = String(form.get("category") ?? "Other");

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
    if (busy || !food) return;
    if (!(await confirm(t.confirmDeleteFood, t.deleteFood))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(itemUrl, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Delete failed");
      onChanged();
      toast.success(t.deleteFood);
      navigate("/fridges/" + encodeURIComponent(fridgeId), { replace: true });
    } catch {
      setError(t.actionFailed);
      toast.error(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="food-detail">
      <h1>{foodName(food, language)}</h1>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && <StatusAlert>{error}</StatusAlert>}
      <FoodPhoto
        key={JSON.stringify([fridgeId, food.id, food.hasPhoto])}
        fridgeId={fridgeId}
        food={food}
        language={language}
      />
      <dl className="item-facts">
        <div>
          <dt>{t.expiry}</dt>
          <dd>{expiryLabel(food.expiry, language)}</dd>
        </div>
        <div>
          <dt>{t.category}</dt>
          <dd>{categoryLabel(food.category, language) || "—"}</dd>
        </div>
        <div>
          <dt>{t.duplicates}</dt>
          <dd>{group.length - 1}</dd>
        </div>
      </dl>
      {group.length > 1 && (
        <div>
          <p className="small">{t.matching}</p>
          <div className="item-picker">
            {group.map((item, index) => (
              <Link
                key={item.id}
                to={route(fridgeId, item.id)}
                aria-current={item.id === food.id ? "page" : undefined}
              >
                {t.itemNumber} {index + 1}
              </Link>
            ))}
          </div>
        </div>
      )}
      {advice && <p>{advice}</p>}

      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setEditing((prev) => !prev);
            setError(null);
          }}
        >
          {editing ? t.cancel : t.editFood}
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void removeItem()}
        >
          {t.deleteFood}
        </button>
      </div>

      {editing && (
        <form
          className="surface add-form edit-form"
          onSubmit={(event) => void saveEdit(event)}
        >
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
              <select
                name="category"
                defaultValue={
                  Object.hasOwn(categories, food.category)
                    ? food.category
                    : "Other"
                }
              >
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
      )}
    </section>
  );
}

async function prepareJpeg(file: File): Promise<string> {
  if (file.size > 25_000_000) throw new Error("Photo is too large");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
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
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const t = words[language];
  const navigate = useNavigate();
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
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      estimated_expiry_date: String(form.get("expiry") ?? ""),
      category: String(form.get("category") ?? "Other"),
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
      navigate("/fridges/" + encodeURIComponent(fridgeId), {
        replace: true,
        state: { added: true },
      });
    } catch {
      setError("save");
      setSaving(false);
    }
  }

  return (
    <section className="food-detail">
      <h1>{t.addFood}</h1>
      <form className="surface add-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={saving}>
          <label>
            {t.name}
            <input name="name" required maxLength={100} autoComplete="off" />
          </label>
          <label>
            {t.expiry}
            <input
              name="expiry"
              type="date"
              required
              aria-describedby="expiry-help"
            />
          </label>
          <p className="small" id="expiry-help">
            {t.expiryHelp}
          </p>
          <label>
            {t.category}
            <select name="category" defaultValue="Other">
              {Object.keys(categories).map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category, language)}
                </option>
              ))}
            </select>
          </label>
          <div className="photo-picker">
            <p>{t.optionalPhoto}</p>
            {photo && (
              <img
                className="food-preview"
                src={"data:image/jpeg;base64," + photo}
                alt=""
              />
            )}
            <div className="photo-actions">
              {([false, true] as const).map((camera) => (
                <label className="secondary photo-label" key={String(camera)}>
                  {camera ? t.takePhoto : t.pickPhoto}
                  <input
                    type="file"
                    accept="image/*"
                    capture={camera ? "environment" : undefined}
                    disabled={photoBusy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void selectPhoto(file);
                    }}
                  />
                </label>
              ))}
              {photo && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPhoto(null)}
                >
                  {t.removePhoto}
                </button>
              )}
            </div>
          </div>
        </fieldset>
        {photoBusy && <p role="status">{t.loading}</p>}
        {error && (
          <p className="error" role="alert">
            {error === "photo" ? t.fileError : t.saveError}
          </p>
        )}
        <div className="form-actions">
          <button
            className="primary"
            disabled={saving || photoBusy}
            type="submit"
          >
            {saving ? t.saving : t.save}
          </button>
          <Link
            className="secondary"
            to={"/fridges/" + encodeURIComponent(fridgeId)}
          >
            {t.cancel}
          </Link>
        </div>
      </form>
    </section>
  );
}
