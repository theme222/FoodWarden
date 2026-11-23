import { Plus, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ReadingTime } from "../components/reading-time";
import { StatusAlert } from "../components/status-alert";
import { useNow } from "../data";
import type { Fridge, Language } from "../model";
import { Sheet } from "../Sheet";
import { TEMP_DANGER_C, VOC_DANGER } from "../state/dashboard-machine";
import { words } from "../words";

export function FridgeHub({
  fridges,
  language,
  onCreated,
}: {
  fridges: Fridge[];
  language: Language;
  onCreated: () => void;
}) {
  const th = language === "th";
  const now = useNow();
  const t = words[language];
  const navigate = useNavigate();
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(false);
    try {
      const res = await fetch("/api/fridges", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Create failed");
      const created = (await res.json()) as { id: string };
      setName("");
      setOpenCreate(false);
      onCreated();
      void navigate("/fridges/" + encodeURIComponent(created.id));
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hub-heading">
        <h1>{t.home}</h1>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setError(false);
            setOpenCreate(true);
          }}
        >
          <Plus size={19} aria-hidden="true" />
          {t.createFridge}
        </button>
      </div>

      {fridges.length === 0 ? (
        <p className="empty-state">{t.emptyFridges}</p>
      ) : (
        <div className="hub-grid">
          {fridges.map((fridge) => {
            const temp = fridge.latest?.temperature ?? null;
            const voc = fridge.latest?.voc ?? null;
            const warm = temp !== null && temp > TEMP_DANGER_C;
            const spoil = voc !== null && voc >= VOC_DANGER;
            const statusText =
              fridge.lastSeenS > 0
                ? th
                  ? "พร้อมใช้งาน"
                  : "Connected"
                : th
                  ? "รอเชื่อมต่ออุปกรณ์"
                  : "Waiting for devices";
            return (
              <Link
                key={fridge.id}
                className="fcard"
                to={"/fridges/" + encodeURIComponent(fridge.id)}
              >
                <div className="fcard-top">
                  <div>
                    <h2>{fridge.name}</h2>
                    <p className="small">
                      {fridge.latest ? (
                        <ReadingTime timeS={fridge.latest.timeS} now={now} language={language} />
                      ) : (
                        statusText
                      )}
                    </p>
                  </div>
                  <span className="fcard-role small">
                    {fridge.role === "owner" ? t.ownerBadge : t.memberBadge}
                  </span>
                </div>
                <div className="fcard-stats">
                  <div className="stat">
                    <span className="k">{t.temperature}</span>
                    <span className={`v${warm ? " bad" : ""}`}>
                      {temp === null ? "—" : `${temp.toFixed(1)}°C`}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">VOC</span>
                    <span className={`v${spoil ? " warn" : ""}`}>
                      {voc === null ? "—" : Math.round(voc)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="k">{th ? "อาหารทั้งหมด" : "Food items"}</span>
                    <span className="v">{fridge.inventoryCount ?? "—"}</span>
                  </div>
                  <div className="stat">
                    <span className="k">{th ? "หมดอายุใน 3 วัน" : "Expiring within 3 days"}</span>
                    <span className={`v${fridge.expiringSoonCount ? " warn" : ""}`}>
                      {fridge.expiringSoonCount ?? "—"}
                    </span>
                  </div>
                </div>
                <ChevronRight className="fcard-chevron" size={18} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}

      <Sheet
        open={openCreate}
        onOpenChange={setOpenCreate}
        title={t.createFridge}
      >
        <form className="add-form" onSubmit={(event) => void handleCreate(event)}>
          {error && <StatusAlert>{t.actionFailed}</StatusAlert>}
          <fieldset disabled={creating}>
            <label>
              {t.fridgeName}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.fridgeNamePlaceholder}
                maxLength={80}
                required
              />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="primary big" disabled={creating} type="submit">
              {creating ? t.creating : t.createFridge}
            </button>
            <button
              type="button"
              className="btn big"
              onClick={() => setOpenCreate(false)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
