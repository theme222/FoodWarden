import type { Firestore } from "firebase/firestore";
import { useHeartbeat, useNow } from "./data";
import { contactState, localTimestamp, statusTree } from "./model";
import type { Heartbeat, Language, StatusNode } from "./model";
import { words } from "./words";

function Device({ node, heartbeat, now, language }: {
  node: StatusNode; heartbeat: Heartbeat | null; now: number; language: Language;
}) {
  const t = words[language];
  const state = contactState(node, heartbeat, now);
  const label = node.id.startsWith("C") ? t.gateway : node.id.startsWith("F") ? t.fridgeSensor
    : node.id.startsWith("D") ? t.doorCloser : t.otherDevice;
  return <article className="device">
    <h2>{label} <span className="device-id">{node.id}</span></h2>
    <p className={"device-state " + state}><span aria-hidden="true" />{t[state]}</p>
    <p className="small">{t.lastActive}{" "}
      {node.lastKnownS === null ? t.unknown : <time dateTime={new Date(node.lastKnownS * 1000).toISOString()}>
        {localTimestamp(node.lastKnownS, language)}
      </time>}
    </p>
    {node.reportedS !== null && node.reportedS !== node.lastKnownS && <p className="small">
      {t.reportedTime} <time dateTime={new Date(node.reportedS * 1000).toISOString()}>
        {localTimestamp(node.reportedS, language)}
      </time>
    </p>}
  </article>;
}

export function Devices({ db, fridgeId, language }: { db: Firestore; fridgeId: string; language: Language }) {
  const live = useHeartbeat(db, fridgeId);
  const now = useNow();
  const t = words[language];
  if (live.error) return <p role="alert">{t.failed}</p>;
  if (live.data === null) return <p role="status">{t.loading}</p>;

  const heartbeat = live.data ?? null;
  const [gateway, ...children] = statusTree(heartbeat);
  return <section aria-labelledby="device-title">
    <h1 id="device-title">{t.devices}</h1>
    <p>{t.deviceIntro}</p>
    {heartbeat && <p className="small">{t.lastReport} {localTimestamp(heartbeat.receivedS, language)}</p>}
    {gateway && <ul className="device-tree">
      <li>
        <Device node={gateway} heartbeat={heartbeat} now={now} language={language} />
        <ul className={"device-children" + (children.length > 2 ? " extended" : "")}>
          {children.map((node) => <li key={node.id}><Device node={node} heartbeat={heartbeat}
            now={now} language={language} /></li>)}
        </ul>
      </li>
    </ul>}
  </section>;
}
