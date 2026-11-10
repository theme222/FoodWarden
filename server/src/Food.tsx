import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import { Link, useNavigate } from "react-router-dom";
import { expiryLabel, foodGroups } from "./model";
import type { Food, Language } from "./model";
import { categories, categoryLabel, foodName, words } from "./words";

function route(fridgeId: string, itemId?: string) {
  return "/fridges/" + encodeURIComponent(fridgeId) + "/food" +
    (itemId ? "/" + encodeURIComponent(itemId) : "");
}

function inventoryEndpoint(fridgeId: string) {
  return "/api/fridges/" + encodeURIComponent(fridgeId) + "/inventory";
}

export function Inventory({ fridgeId, items, language }: {
  fridgeId: string; items: Food[]; language: Language;
}) {
  const t = words[language];
  const groups = foodGroups(items);
  return <section aria-labelledby="food-title">
    <div className="section-head">
      <h2 id="food-title">{t.food}</h2>
      <Link className="primary" to={route(fridgeId, "add")}>＋ {t.addFood}</Link>
    </div>
    {groups.length === 0 ? <p className="surface">{t.emptyFood}</p> : <ul className="food-list">
      {groups.map(([food, ...duplicates]) => food && <li key={food.id}>
        <Link to={route(fridgeId, food.id)}>
          <div><strong>{foodName(food, language)}</strong>
            <span className="small">{t.expiry} {expiryLabel(food.expiry, language)}</span></div>
          <span className="count">× {duplicates.length + 1}</span>
          <span className="chevron" aria-hidden="true">›</span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}

function FoodPhoto({ user, fridgeId, food, language }: {
  user: User; fridgeId: string; food: Food; language: Language;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const t = words[language];

  useEffect(() => {
    if (!food.hasPhoto) return;
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      try {
        const response = await fetch(inventoryEndpoint(fridgeId) + "/" + encodeURIComponent(food.id) + "/photo", {
          signal: controller.signal, headers: { Authorization: "Bearer " + await user.getIdToken() },
        });
        if (!response.ok) throw new Error("Photo unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [user, fridgeId, food.id, food.hasPhoto]);

  if (!food.hasPhoto) return <p className="photo-placeholder">{t.noPhoto}</p>;
  if (failed) return <p className="photo-placeholder" role="alert">{t.photoError}</p>;
  if (!image) return <p className="photo-placeholder" role="status">{t.loading}</p>;
  return <img className="food-photo" src={image} alt={foodName(food, language)} onError={() => setFailed(true)} />;
}

export function FoodDetail({ itemId, items, fridgeId, language, user }: {
  itemId: string; items: Food[]; fridgeId: string; language: Language; user: User;
}) {
  const t = words[language];
  const group = foodGroups(items).find((group) => group.some((food) => food.id === itemId));
  const food = group?.find((food) => food.id === itemId);
  if (!group || !food) return <p role="status">{t.itemMissing}</p>;
  const advice = language === "th" ? food.adviceTh || food.adviceEn : food.adviceEn || food.adviceTh;
  return <section className="food-detail">
    <h1>{foodName(food, language)}</h1>
    <FoodPhoto key={food.id + String(food.hasPhoto)} user={user} fridgeId={fridgeId} food={food} language={language} />
    <dl className="item-facts">
      <div><dt>{t.expiry}</dt><dd>{expiryLabel(food.expiry, language)}</dd></div>
      <div><dt>{t.category}</dt><dd>{categoryLabel(food.category, language) || "—"}</dd></div>
      <div><dt>{t.duplicates}</dt><dd>{group.length - 1}</dd></div>
    </dl>
    {group.length > 1 && <div>
      <p className="small">{t.matching}</p>
      <div className="item-picker">
        {group.map((item, index) => <Link key={item.id} to={route(fridgeId, item.id)}
          aria-current={item.id === food.id ? "page" : undefined}>{t.itemNumber} {index + 1}</Link>)}
      </div>
    </div>}
    {advice && <p>{advice}</p>}
  </section>;
}

async function prepareJpeg(file: File): Promise<string> {
  if (file.size > 25_000_000) throw new Error("Photo is too large");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
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

export function AddFood({ user, fridgeId, language }: { user: User; fridgeId: string; language: Language }) {
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
    if (attempt.current?.payload !== key) attempt.current = { payload: key, id: crypto.randomUUID() };
    const itemId = attempt.current.id;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(inventoryEndpoint(fridgeId), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + await user.getIdToken() },
        body: JSON.stringify({ item_id: itemId, ...payload }),
      });
      if (!response.ok) throw new Error("Save failed");
      navigate("/fridges/" + encodeURIComponent(fridgeId), { replace: true, state: { added: true } });
    } catch {
      setError("save");
      setSaving(false);
    }
  }

  return <section className="food-detail">
    <h1>{t.addFood}</h1>
    <form className="surface add-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={saving}>
        <label>{t.name}<input name="name" required maxLength={100} autoComplete="off" /></label>
        <label>{t.expiry}<input name="expiry" type="date" required aria-describedby="expiry-help" /></label>
        <p className="small" id="expiry-help">{t.expiryHelp}</p>
        <label>{t.category}<select name="category" defaultValue="Other">
          {Object.keys(categories).map((category) => <option key={category} value={category}>
            {categoryLabel(category, language)}
          </option>)}
        </select></label>
        <div className="photo-picker">
          <p>{t.optionalPhoto}</p>
          {photo && <img className="food-preview" src={"data:image/jpeg;base64," + photo} alt="" />}
          <div className="photo-actions">
            {([false, true] as const).map((camera) => <label className="secondary photo-label" key={String(camera)}>
              {camera ? t.takePhoto : t.pickPhoto}
              <input type="file" accept="image/*" capture={camera ? "environment" : undefined}
                disabled={photoBusy} onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void selectPhoto(file);
                }} />
            </label>)}
            {photo && <button type="button" className="secondary" onClick={() => setPhoto(null)}>{t.removePhoto}</button>}
          </div>
        </div>
      </fieldset>
      {photoBusy && <p role="status">{t.loading}</p>}
      {error && <p className="error" role="alert">{error === "photo" ? t.fileError : t.saveError}</p>}
      <div className="form-actions">
        <button className="primary" disabled={saving || photoBusy}>{saving ? t.saving : t.save}</button>
        <Link className="secondary" to={"/fridges/" + encodeURIComponent(fridgeId)}>{t.cancel}</Link>
      </div>
    </form>
  </section>;
}
