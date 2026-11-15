import { useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "./model";
import { LineConnection } from "./LineConnection";
import { useLineStatus, useFavorites, lineAction } from "./line-data";
import { categoryLabel, categories } from "./words";
import { StatusAlert } from "./components/status-alert";
import { toast } from "sonner";
import { Star, Heart, Clock } from "lucide-react";

type Preferences = {
  morning_enabled: boolean;
  morning_time: string;
  inst_obstruct: boolean;
  inst_warm: boolean;
  inst_spoil: boolean;
};
function FavoriteCategories({
  fridgeId,
  language,
}: {
  fridgeId: string;
  language: Language;
}) {
  const state = useFavorites(fridgeId);
  const [busy, setBusy] = useState(false);
  const th = language === "th";
  async function toggle(category: string) {
    if (busy || !state.data) return;
    setBusy(true);
    const selected = state.data.categories.includes(category)
      ? state.data.categories.filter((c) => c !== category)
      : [...state.data.categories, category];
    try {
      await lineAction(
        `/api/fridges/${encodeURIComponent(fridgeId)}/favorites/categories`,
        "PUT",
        { categories: selected },
      );
      await state.mutate();
    } catch {
      toast.error(
        th ? "บันทึกหมวดโปรดไม่สำเร็จ" : "Could not save favorite categories",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface">
      <h2>
        <Heart size={22} aria-hidden="true" />{" "}
        {th ? "ของโปรดของฉันในตู้นี้" : "My favorites in this fridge"}
      </h2>
      <p className="small">
        {th
          ? "มีเพียงคุณที่เห็นรายการนี้ ทุกคนในครอบครัวเลือกของโปรดได้ต่างกัน"
          : "Only you see this list. Everyone has their own favorites."}
      </p>
      {state.error ? (
        <StatusAlert>
          {th ? "โหลดของโปรดไม่ได้" : "Could not load favorites"}
        </StatusAlert>
      ) : !state.data ? (
        <output>{th ? "กำลังโหลด…" : "Loading…"}</output>
      ) : (
        <>
          <h3>{th ? "หมวดอาหารโปรด" : "Favorite food types"}</h3>
          <div className="category-chips">
            {Object.keys(categories).map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={state.data!.categories.includes(category)}
                disabled={busy}
                onClick={() => void toggle(category)}
              >
                {categoryLabel(category, language)} (
                {state.data?.category_counts[category] ?? 0})
              </button>
            ))}
          </div>
          <h3>{th ? "อาหารโปรด" : "Favorite foods"}</h3>
          {!state.data.items.length ? (
            <p className="empty-note">
              {th
                ? "ไปที่รายการอาหาร แล้วแตะดาวข้างของที่ชอบ"
                : "Open the food list and star something you like."}
            </p>
          ) : (
            <ul className="favorite-list">
              {state.data.items.map((item) => (
                <li key={item.item_key}>
                  <div>
                    <strong>
                      {language === "th" ? item.name_th : item.name_en}
                    </strong>
                    <span className="small">
                      {item.count
                        ? th
                          ? `เหลือ ${item.count} ชิ้น`
                          : `${item.count} left`
                        : th
                          ? "หมดแล้ว · อาจต้องซื้อเพิ่ม"
                          : "Out of stock · buy more?"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    aria-label={
                      (th ? "ลบของโปรด " : "Remove favorite ") +
                      (language === "th" ? item.name_th : item.name_en)
                    }
                    onClick={() => {
                      setBusy(true);
                      void lineAction(
                        `/api/fridges/${encodeURIComponent(fridgeId)}/favorites/${item.item_key}`,
                        "DELETE",
                      )
                        .then(() => state.mutate())
                        .catch(() =>
                          toast.error(
                            th ? "ลบไม่ได้" : "Could not remove favorite",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Star fill="currentColor" size={20} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
export function MyAccount({
  language,
  fridgeId,
}: {
  language: Language;
  fridgeId?: string;
}) {
  const th = language === "th";
  const profile = useLineStatus("/api/me/line");
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const value: Preferences = draft ?? {
    morning_enabled: profile.data?.morning_enabled ?? true,
    morning_time: profile.data?.morning_time ?? "07:30",
    inst_obstruct: profile.data?.inst_obstruct ?? true,
    inst_warm: profile.data?.inst_warm ?? true,
    inst_spoil: profile.data?.inst_spoil ?? true,
  };
  function change<K extends keyof Preferences>(key: K, next: Preferences[K]) {
    setDraft({ ...value, [key]: next });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await lineAction("/api/me/line", "PATCH", value);
      await profile.mutate();
      setDraft(null);
      toast.success(
        th ? "บันทึกการแจ้งเตือนแล้ว" : "Notification preferences saved",
      );
    } catch {
      toast.error(th ? "บันทึกไม่ได้ กรุณาลองใหม่" : "Could not save preferences");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page">
      <div className="page-heading">
        <h1>{th ? "ของฉัน" : "Me"}</h1>
        <p>
          {th
            ? "LINE ของโปรด และการแจ้งเตือนเฉพาะคุณ การเปลี่ยนที่นี่ไม่กระทบคนอื่นในบ้าน"
            : "Your LINE, favorites and notifications. Changes here do not affect anyone else."}
        </p>
      </div>
      <LineConnection language={language} />
      <form
        onSubmit={(event) => void save(event)}
        className="surface notification-preferences"
      >
        <h2>
          <Clock size={22} aria-hidden="true" />{" "}
          {th ? "การแจ้งเตือนของฉัน" : "My notifications"}
        </h2>
        <fieldset disabled={busy || !profile.data}>
          <legend>{th ? "สรุปตอนเช้า" : "Morning summary"}</legend>
          <label className="toggle-row">
            <span>{th ? "ส่งสรุปให้ฉันทุกเช้า" : "Send me a morning summary"}</span>
            <input
              type="checkbox"
              checked={value.morning_enabled}
              onChange={(e) => change("morning_enabled", e.target.checked)}
            />
          </label>
          <label>
            {th ? "เวลา (ประเทศไทย)" : "Time (Asia/Bangkok)"}
            <input
              type="time"
              value={value.morning_time}
              disabled={!value.morning_enabled}
              onChange={(e) => change("morning_time", e.target.value)}
              required
            />
          </label>
          <p className="small">
            {th
              ? "รวมอาหารใกล้หมดอายุ ของโปรด และสถานะจากทุกตู้ที่คุณเป็นสมาชิก หากไม่มีเรื่องให้รายงานจะไม่ส่ง"
              : "Includes expiring food, favorites and activity from your fridges. Days with nothing to report are skipped."}
          </p>
          <h3>{th ? "แจ้งทันทีเมื่อ" : "Tell me right away when"}</h3>
          {(
            [
              [
                "inst_obstruct",
                th
                  ? "ประตูมีสิ่งกีดขวางหรืออุปกรณ์ผิดปกติ"
                  : "Door obstruction or a device fault",
              ],
              ["inst_warm", th ? "ตู้เย็นร้อนเกินไป" : "The fridge gets too warm"],
              [
                "inst_spoil",
                th
                  ? "ค่า VOC สูง อาหารอาจเริ่มเสีย"
                  : "High VOC suggests possible spoilage",
              ],
            ] as const
          ).map(([key, label]) => (
            <label className="toggle-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
            </label>
          ))}
          <button type="submit" className="primary">
            {busy
              ? th
                ? "กำลังบันทึก…"
                : "Saving…"
              : th
                ? "บันทึกการแจ้งเตือน"
                : "Save preferences"}
          </button>
        </fieldset>
      </form>
      {fridgeId && (
        <FavoriteCategories fridgeId={fridgeId} language={language} />
      )}
    </div>
  );
}
