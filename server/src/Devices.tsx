import { useNow } from "./data";
import { contactState, localTimestamp, statusTree } from "./model";
import type { DoorEvent, Heartbeat, Language, StatusNode } from "./model";
import { words } from "./words";

function Device({
  node,
  heartbeat,
  now,
  language,
}: {
  node: StatusNode;
  heartbeat: Heartbeat | null;
  now: number;
  language: Language;
}) {
  const t = words[language];
  const state = contactState(node, heartbeat, now);
  const label = node.id.startsWith("C")
    ? t.gateway
    : node.id.startsWith("F")
      ? t.fridgeSensor
      : node.id.startsWith("D")
        ? t.doorCloser
        : t.otherDevice;
  return (
    <article className="device">
      <h2>
        {label} <span className="device-id">{node.id}</span>
      </h2>
      <p className={"device-state " + state}>
        <span aria-hidden="true" />
        {t[state]}
      </p>
      <p className="small">
        {t.lastActive}{" "}
        {node.lastKnownS === null ? (
          t.unknown
        ) : (
          <time dateTime={new Date(node.lastKnownS * 1000).toISOString()}>
            {localTimestamp(node.lastKnownS, language)}
          </time>
        )}
      </p>
      {node.reportedS !== null && node.reportedS !== node.lastKnownS && (
        <p className="small">
          {t.reportedTime}{" "}
          <time dateTime={new Date(node.reportedS * 1000).toISOString()}>
            {localTimestamp(node.reportedS, language)}
          </time>
        </p>
      )}
    </article>
  );
}

function doorStatusLabel(
  status: DoorEvent["status"],
  language: Language,
): string {
  const t = words[language];
  const key = ("door_" + status) as keyof typeof t;
  return t[key] ?? status;
}

export function Devices({
  heartbeat,
  doorEvents,
  error,
  language,
}: {
  heartbeat: Heartbeat | null | undefined;
  doorEvents: DoorEvent[] | null;
  error: boolean;
  language: Language;
}) {
  const now = useNow();
  const t = words[language];
  if (error) return <p role="alert">{t.failed}</p>;
  if (heartbeat === undefined) return <p role="status">{t.loading}</p>;

  const resolvedHeartbeat = heartbeat ?? null;
  const [gateway, ...children] = statusTree(resolvedHeartbeat);
  return (
    <section aria-labelledby="device-title">
      <h1 id="device-title">{t.devices}</h1>
      <p>{t.deviceIntro}</p>
      {resolvedHeartbeat && (
        <p className="small">
          {t.lastReport} {localTimestamp(resolvedHeartbeat.receivedS, language)}
        </p>
      )}
      {gateway && (
        <ul className="device-tree">
          <li>
            <Device
              node={gateway}
              heartbeat={resolvedHeartbeat}
              now={now}
              language={language}
            />
            <ul
              className={
                "device-children" + (children.length > 2 ? " extended" : "")
              }
            >
              {children.map((node) => (
                <li key={node.id}>
                  <Device
                    node={node}
                    heartbeat={resolvedHeartbeat}
                    now={now}
                    language={language}
                  />
                </li>
              ))}
            </ul>
          </li>
        </ul>
      )}
      <section className="door-events-section" aria-labelledby="door-title">
        <h2 id="door-title">{t.doorEvents}</h2>
        {!doorEvents ? (
          <p role="status">{t.loading}</p>
        ) : doorEvents.length === 0 ? (
          <p className="surface">{t.emptyDoorEvents}</p>
        ) : (
          <ul className="door-list surface">
            {doorEvents.map((event) => {
              const isAlert =
                event.status !== "SUCCESS" && event.status !== "CLOSING";
              return (
                <li
                  key={`${event.nodeId}-${event.timestampS}-${event.status}`}
                  className={isAlert ? "door-item door-alert" : "door-item"}
                >
                  <div>
                    <strong>{doorStatusLabel(event.status, language)}</strong>
                    <span className="device-id"> {event.nodeId}</span>
                  </div>
                  <time
                    className="small"
                    dateTime={new Date(event.timestampS * 1000).toISOString()}
                  >
                    {localTimestamp(event.timestampS, language)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
