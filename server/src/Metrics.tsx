import { Thermometer, Wind, Sun, DoorClosed } from "lucide-react";
import { Link } from "react-router-dom";
import { useUiVersion } from "./components/ui-version-context";
import { FRIDGE_SENSOR_STALE_S, localTimestamp } from "./model";
import type { DoorEvent, Language, Sample } from "./model";
import { deriveKpiSummary, LIGHT_OPEN_LDR } from "./state/dashboard-machine";
import { words } from "./words";

const icons = {
  temperature: Thermometer,
  voc: Wind,
  light: Sun,
  door: DoorClosed,
};

export function ReadingTime({
  timeS,
  now,
  language,
}: {
  timeS: number;
  now: number;
  language: Language;
}) {
  const seconds = Math.max(0, now - timeS);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "always" });
  const relative =
    seconds < 60
      ? language === "th"
        ? "เมื่อสักครู่"
        : "Just now"
      : seconds < 3600
        ? format.format(-Math.floor(seconds / 60), "minute")
        : seconds < 86400
          ? format.format(-Math.floor(seconds / 3600), "hour")
          : format.format(-Math.floor(seconds / 86400), "day");
  return (
    <time dateTime={new Date(timeS * 1000).toISOString()}>
      {relative}{" "}
      <span className="small">· {localTimestamp(timeS, language)}</span>
    </time>
  );
}

export function Metrics({
  latest,
  now,
  language,
  failed,
  fridgeId,
  doorEvents = [],
}: {
  latest: Sample | null;
  now: number;
  language: Language;
  failed: boolean;
  fridgeId?: string;
  doorEvents?: DoorEvent[];
}) {
  const th = language === "th";
  const t = words[language];
  const { version } = useUiVersion();
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
          {failed ? (
            t.failed
          ) : latest ? (
            <>
              {now - latest.timeS > FRIDGE_SENSOR_STALE_S &&
                (th ? "ข้อมูลเก่า · " : "Stale · ")}
              <ReadingTime timeS={latest.timeS} now={now} language={language} />
            </>
          ) : (
            t.waitingReadings
          )}
        </p>
      </div>
      <ul className="sensor-metrics">
        {tiles
          .filter((tile) => version === "v2" || tile.id !== "door")
          .map((tile) => {
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
                        className={
                          tile.alert ? "sensor-metric-alert" : undefined
                        }
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
                ? base + "/history?kind=door"
                : base + "/charts?metric=" + tile.id;
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
