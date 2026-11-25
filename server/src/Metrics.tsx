import { Thermometer, Wind, Sun, DoorClosed } from "lucide-react";
import { Link } from "react-router-dom";
import { ReadingTime } from "./components/reading-time";
import { FRIDGE_SENSOR_STALE_S } from "./model";
import type { DoorEvent, Language, Sample } from "./model";
import { deriveKpiSummary, LIGHT_OPEN_LDR } from "./state/dashboard-machine";
import { words } from "./words";

const icons = {
  temperature: Thermometer,
  voc: Wind,
  light: Sun,
  door: DoorClosed,
};

export function Metrics({
  latest,
  now,
  language,
  failed,
  onRetry,
  fridgeId,
  doorEvents = [],
}: {
  latest: Sample | null;
  now: number;
  language: Language;
  failed: boolean;
  onRetry?: () => void;
  fridgeId?: string;
  doorEvents?: DoorEvent[];
}) {
  const th = language === "th";
  const t = words[language];
  const tiles = deriveKpiSummary(latest, doorEvents, now, language);
  const labels = {
    temperature: t.temperature,
    voc: t.voc,
    light: t.light,
    door: th ? "ประตูล่าสุด" : "Last door event",
  };
  const base = "/fridges/" + encodeURIComponent(fridgeId ?? "");

  return (
    <section
      className="sensor-summary"
      aria-label={th ? "ข้อมูลล่าสุด" : "Latest readings"}
    >
      <div className="sensor-summary-heading">
        <h2>{th ? "ข้อมูลล่าสุด" : "Latest readings"}</h2>
        <p className="small">
          {latest ? (
            <>
              {now - latest.timeS > FRIDGE_SENSOR_STALE_S &&
                (th ? "ข้อมูลเก่า · " : "Stale · ")}
              <ReadingTime timeS={latest.timeS} now={now} language={language} />
            </>
          ) : failed ? (
            t.failed
          ) : (
            t.waitingReadings
          )}
        </p>
        {failed && onRetry && (
          <button type="button" className="btn sm" onClick={onRetry}>
            {th ? "ลองโหลดค่าล่าสุด" : "Retry latest readings"}
          </button>
        )}
      </div>
      <ul className="sensor-metrics">
        {tiles.map((tile) => {
          const Icon = icons[tile.id];
          const content = (
            <>
              <span className="sensor-metric-label">
                <Icon size={17} aria-hidden="true" />
                {labels[tile.id]}
              </span>
              {tile.id === "door" ? (
                doorEvents[0] ? (
                  <>
                    <strong
                      className={tile.alert ? "sensor-metric-alert" : undefined}
                    >
                      {t[`door_${doorEvents[0].status}`]}
                    </strong>
                    <span className="small">
                      <ReadingTime
                        timeS={doorEvents[0].timestampS}
                        now={now}
                        language={language}
                      />
                    </span>
                  </>
                ) : (
                  <span className="small">{t.emptyDoorEvents}</span>
                )
              ) : (
                <>
                  <strong>
                    {tile.reading} {tile.unit}
                  </strong>
                  <span
                    className={tile.alert ? "sensor-metric-alert" : "small"}
                  >
                    {tile.id !== "light" || latest?.light == null
                      ? tile.verdict
                      : latest.light > LIGHT_OPEN_LDR
                        ? th
                          ? "ตรวจพบแสง"
                          : "Light detected"
                        : th
                          ? "ภายในมืด"
                          : "Dark inside"}
                  </span>
                </>
              )}
            </>
          );
          const target =
            tile.id === "door"
              ? base + "/monitoring/history?kind=door"
              : base + "/monitoring?metric=" + tile.id;
          return (
            <li key={tile.id}>
              {fridgeId ? (
                <Link to={target}>{content}</Link>
              ) : (
                <div>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
