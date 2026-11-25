import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  MessageCircle,
  Check,
  Copy,
  Unplug,
  Send,
  RotateCcw,
} from "lucide-react";
import { ApiRequestError } from "./lib/api";
import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import {
  useLineStatus,
  lineAction,
  parsePairing,
  readStoredPairing,
  writeStoredPairing,
} from "./line-data";
import type { Language } from "./model";

function useLineConnection({
  language,
  fridgeId,
  fridgeName,
  manage = true,
}: {
  language: Language;
  fridgeId?: string;
  fridgeName?: string;
  manage?: boolean;
}) {
  const th = language === "th";
  const url = fridgeId
    ? `/api/fridges/${encodeURIComponent(fridgeId)}/line`
    : "/api/me/line";
  const [code, setCode] = useState<{
    code: string;
    expires_at_s: number;
  } | null>(() => readStoredPairing(url));
  const [clock, setClock] = useState(() => Date.now());
  const status = useLineStatus(
    url,
    Boolean(code && code.expires_at_s * 1000 > clock),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const data = status.data;
  const seconds = code
    ? Math.max(0, code.expires_at_s - Math.floor(clock / 1000))
    : 0;

  useEffect(() => {
    if (data?.linked) {
      writeStoredPairing(url, null);
      return;
    }
    if (!code) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code, data?.linked, url]);

  async function action(kind: "pair" | "test" | "disconnect") {
    if (busy) return;
    if (
      kind === "disconnect" &&
      !(await confirm(
        th
          ? "ตัดการเชื่อมต่อ LINE? คำขอแจ้งเตือนที่ค้างอยู่จะถูกยกเลิก"
          : "Disconnect LINE and cancel pending notifications?",
        th ? "ตัดการเชื่อมต่อ" : "Disconnect",
      ))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await lineAction(
        kind === "disconnect" ? url : `${url}/${kind}`,
        kind === "disconnect" ? "DELETE" : "POST",
      );
      if (kind === "pair") {
        const next = parsePairing(response);
        writeStoredPairing(url, next);
        setCode(next);
        setClock(Date.now());
      } else if (kind === "disconnect") {
        writeStoredPairing(url, null);
        setCode(null);
        toast.success(th ? "ตัดการเชื่อมต่อแล้ว" : "LINE disconnected");
      } else {
        const result =
          response && typeof response === "object" && "status" in response
            ? response.status
            : "queued";
        if (result === "failed") {
          setError(
            th
              ? "ส่งทดสอบไม่สำเร็จ ตรวจการเชื่อมต่อ LINE แล้วลองใหม่"
              : "Test failed. Check your LINE connection and try again.",
          );
        } else {
          toast.success(
            result === "accepted"
              ? th
                ? "LINE รับคำขอแล้ว โปรดตรวจแชท"
                : "LINE accepted the request. Check your chat."
              : th
                ? "เข้าคิวส่งข้อความทดสอบแล้ว"
                : "Test message queued.",
          );
        }
        return;
      }
      await status.mutate();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 429
          ? th
            ? "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"
            : "Too many requests. Wait before trying again."
          : th
            ? "ทำรายการไม่สำเร็จ กรุณาลองใหม่"
            : "This action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    th,
    fridgeId,
    fridgeName,
    manage,
    code,
    seconds,
    busy,
    error,
    status,
    data,
    action,
  };
}

type LineView = ReturnType<typeof useLineConnection>;

function lineConnectionText(
  th: boolean,
  fridgeId?: string,
  fridgeName?: string,
) {
  if (fridgeId) {
    return th
      ? {
          title: "LINE ของครอบครัว",
          label: "LINE ของตู้เย็น",
          description: fridgeName
            ? `แจ้งเรื่องประตู อุณหภูมิ และสรุปอาหารของตู้ "${fridgeName}" ไปยังแชทที่ครอบครัวเลือก`
            : "แจ้งเรื่องประตู อุณหภูมิ และสรุปอาหารไปยังแชทที่ครอบครัวเลือก",
        }
      : {
          title: "Family LINE",
          label: "Fridge LINE",
          description: fridgeName
            ? `Send fridge alerts for "${fridgeName}" to your chosen family chat.`
            : "Send fridge alerts to your chosen family chat.",
        };
  }
  return th
    ? {
        title: "LINE ส่วนตัวของฉัน",
        label: "LINE ส่วนตัวของฉัน",
        description:
          "การเชื่อมต่อนี้เป็นของคุณเท่านั้น สมาชิกคนอื่นมี LINE และการตั้งค่าของตัวเอง",
      }
    : {
        title: "My LINE",
        label: "My LINE",
        description:
          "Only your account uses this connection. Everyone has their own settings.",
      };
}

function LineConnectionHeading({ view }: { view: LineView }) {
  const { th, fridgeId, fridgeName, data } = view;
  const text = lineConnectionText(th, fridgeId, fridgeName);
  return (
    <div className="flex flex-col gap-2">
      <div className="page-head">
        <div className="flex items-center gap-3">
          <span className="conn-ic line" aria-hidden="true">
            <MessageCircle size={20} />
          </span>
          <h2>{text.title}</h2>
        </div>
        <span className={`pill ${data?.linked ? "fresh" : "neutral"}`}>
          {data?.linked ? (
            <>
              <Check size={15} aria-hidden="true" />
              {th ? "เชื่อมต่อแล้ว" : "Connected"}
            </>
          ) : th ? (
            "ยังไม่เชื่อมต่อ"
          ) : (
            "Not connected"
          )}
        </span>
      </div>
      <p className="sub">{text.description}</p>
    </div>
  );
}

function LinkedLineActions({ view }: { view: LineView }) {
  const { th, manage, busy, action } = view;
  if (!manage) return null;
  return (
    <div className="form-actions">
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void action("test")}
      >
        <Send size={17} aria-hidden="true" />
        {th ? "ส่งข้อความทดสอบ" : "Send test"}
      </button>
      <button
        type="button"
        className="btn danger-ghost"
        disabled={busy}
        onClick={() => void action("disconnect")}
      >
        <Unplug size={17} aria-hidden="true" />
        {th ? "ตัดการเชื่อมต่อ" : "Disconnect"}
      </button>
    </div>
  );
}

function AddLineFriend({ view }: { view: LineView }) {
  const { th, fridgeId, data } = view;
  if (!data) return null;
  return (
    <div>
      <h3>{th ? "1. เพิ่ม FoodWarden ใน LINE" : "1. Add FoodWarden in LINE"}</h3>
      <p className="sub">
        {th
          ? fridgeId
            ? "เพิ่มเพื่อนบอท แล้วเชิญบอทเข้ากลุ่มครอบครัวที่ต้องการแจ้งเตือน"
            : "เพิ่มเพื่อนบอท FoodWarden เพื่อรับการแจ้งเตือนส่วนตัว"
          : fridgeId
            ? "Add the bot, then invite it to your family group."
            : "Add the FoodWarden bot for private notifications."}
      </p>
      {data.friend_url ? (
        <div className="flex flex-col items-start gap-3">
          <a
            className="primary sm"
            href={data.friend_url}
            target="_blank"
            rel="noreferrer"
          >
            {th ? "เพิ่มเพื่อนใน LINE" : "Add friend in LINE"}
          </a>
          <QRCodeSVG
            value={data.friend_url}
            size={128}
            marginSize={4}
            title={th ? "สแกนเพื่อเพิ่มเพื่อน FoodWarden" : "Scan to add FoodWarden"}
          />
        </div>
      ) : (
        <p className="small">
          {th
            ? "ผู้ดูแลต้องเพิ่มลิงก์บอทก่อนแสดง QR code หากเพิ่มเพื่อนแล้ว สามารถใช้รหัสด้านล่างได้เลย"
            : "The administrator must set the bot link to show a QR code. If already added, continue below."}
        </p>
      )}
    </div>
  );
}

function CreatePairingCode({ view }: { view: LineView }) {
  const { th, busy, action } = view;
  return (
    <button
      type="button"
      className="primary"
      disabled={busy}
      onClick={() => void action("pair")}
    >
      {busy
        ? th
          ? "กำลังสร้าง…"
          : "Creating…"
        : th
          ? "สร้างรหัสเชื่อมต่อ"
          : "Create connection code"}
    </button>
  );
}

function PairingCode({ view }: { view: LineView }) {
  const { th, code, seconds } = view;
  if (!code || seconds <= 0) return <CreatePairingCode view={view} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="pairing-code">
        <code>{code.code}</code>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            void navigator.clipboard
              .writeText(code.code)
              .then(() => toast.success(th ? "คัดลอกรหัสแล้ว" : "Code copied"))
              .catch(() =>
                toast.error(
                  th
                    ? "คัดลอกไม่ได้ กรุณาเลือกรหัสเพื่อคัดลอกเอง"
                    : "Select the code to copy it manually",
                ),
              )
          }
        >
          <Copy size={16} aria-hidden="true" />
          {th ? "คัดลอก" : "Copy"}
        </button>
      </div>
      <p className="small num">
        {th ? "หมดอายุใน" : "Expires in"} {Math.floor(seconds / 60)}:
        {String(seconds % 60).padStart(2, "0")} ·{" "}
        {th
          ? "รหัสใช้ได้ครั้งเดียว อย่าส่งให้คนที่ไม่รู้จัก"
          : "One use only. Keep it private."}
      </p>
      <output className="small">
        {th
          ? "ส่งรหัสแล้วรอสักครู่ หน้านี้จะอัปเดตเอง"
          : "After sending, this page updates automatically."}
      </output>
    </div>
  );
}

function LinePairingSteps({ view }: { view: LineView }) {
  const { th, fridgeId } = view;
  return (
    <div className="line-steps">
      <AddLineFriend view={view} />
      <div>
        <h3>{th ? "2. ส่งรหัสในแชทกับบอท" : "2. Send a code to the bot"}</h3>
        <p className="sub">
          {th
            ? fridgeId
              ? "ส่งในกลุ่มที่เชิญบอทแล้ว หรือแชทกับบอทโดยตรง"
              : "ส่งในแชทส่วนตัวกับบอทเท่านั้น ไม่ส่งรหัสส่วนตัวในกลุ่ม"
            : fridgeId
              ? "Send it in the group or directly to the bot."
              : "Send personal codes in a direct chat, never in a group."}
        </p>
        <PairingCode view={view} />
      </div>
    </div>
  );
}

function LineConnectionBody({ view }: { view: LineView }) {
  const { th, data, manage } = view;
  if (!data)
    return <output className="sub">{th ? "กำลังโหลด…" : "Loading…"}</output>;
  if (!data.ready) {
    return (
      <div className="subblock">
        <p className="sub">
          {th
            ? "ผู้ดูแลยังไม่ได้เปิดใช้งาน LINE สำหรับระบบนี้ คุณสามารถตั้งค่าการแจ้งเตือนรอไว้ได้"
            : "LINE has not been enabled by the administrator yet. You can still save your preferences."}
        </p>
      </div>
    );
  }
  if (data.linked) return <LinkedLineActions view={view} />;
  if (!manage) return null;
  return <LinePairingSteps view={view} />;
}

function LineConnectionSection(props: Parameters<typeof useLineConnection>[0]) {
  const view = useLineConnection(props);
  const { th, fridgeId, fridgeName, error, status } = view;
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== "#line-connection") return;
    section.current?.scrollIntoView();
    section.current?.focus({ preventScroll: true });
  }, [hash]);
  return (
    <section
      ref={section}
      id="line-connection"
      tabIndex={-1}
      className="panel flex scroll-mt-20 flex-col gap-3"
      aria-label={lineConnectionText(th, fridgeId, fridgeName).label}
    >
      <LineConnectionHeading view={view} />
      {error && <StatusAlert>{error}</StatusAlert>}
      {status.error && (
        <StatusAlert
          action={
            <button
              type="button"
              className="btn sm"
              onClick={() => void status.mutate()}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {th ? "ลองใหม่" : "Retry"}
            </button>
          }
        >
          {th ? "โหลดสถานะไม่สำเร็จ" : "Could not load connection status"}
        </StatusAlert>
      )}
      <LineConnectionBody view={view} />
    </section>
  );
}

export function LineConnection(props: Parameters<typeof useLineConnection>[0]) {
  return <LineConnectionSection key={props.fridgeId ?? "me"} {...props} />;
}
