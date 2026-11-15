import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ApiRequestError } from "./lib/api";
import { useConfirm } from "./components/confirmation";
import { StatusAlert } from "./components/status-alert";
import { useLineStatus, lineAction, parsePairing } from "./line-data";
import type { Language } from "./model";
import { MessageCircle, Check, Copy, Unplug, Send } from "lucide-react";
export function LineConnection({
  language,
  fridgeId,
  manage = true,
}: {
  language: Language;
  fridgeId?: string;
  manage?: boolean;
}) {
  const th = language === "th";
  const url = fridgeId
    ? `/api/fridges/${encodeURIComponent(fridgeId)}/line`
    : "/api/me/line";
  const [code, setCode] = useState<{
    code: string;
    expires_at_s: number;
  } | null>(null);
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
    if (!code || data?.linked) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code, data?.linked]);
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
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const response = await lineAction(
        kind === "disconnect" ? url : `${url}/${kind}`,
        kind === "disconnect" ? "DELETE" : "POST",
      );
      if (kind === "pair") {
        setCode(parsePairing(response));
        setClock(Date.now());
      } else if (kind === "disconnect") {
        setCode(null);
        toast.success(th ? "ตัดการเชื่อมต่อแล้ว" : "LINE disconnected");
      } else
        toast.success(
          th
            ? "รับคำขอทดสอบแล้ว โปรดตรวจแชท LINE"
            : "Test queued. Check your LINE chat.",
        );
      await status.mutate();
    } catch (error) {
      setError(
        error instanceof ApiRequestError && error.status === 429
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
  return (
    <section
      className="surface line-connection"
      aria-label={
        th
          ? fridgeId
            ? "LINE ของตู้เย็น"
            : "LINE ส่วนตัวของฉัน"
          : fridgeId
            ? "Fridge LINE"
            : "My LINE"
      }
    >
      <div className="section-head">
        <h2>
          <MessageCircle aria-hidden="true" />
          {th
            ? fridgeId
              ? "LINE ของครอบครัว"
              : "LINE ส่วนตัวของฉัน"
            : fridgeId
              ? "Family LINE"
              : "My LINE"}
        </h2>
        <span className={`connection-badge ${data?.linked ? "connected" : ""}`}>
          {data?.linked ? (
            <>
              <Check size={16} aria-hidden="true" />
              {th ? "เชื่อมต่อแล้ว" : "Connected"}
            </>
          ) : th ? (
            "ยังไม่เชื่อมต่อ"
          ) : (
            "Not connected"
          )}
        </span>
      </div>
      <p className="small">
        {th
          ? fridgeId
            ? "แจ้งเรื่องประตู อุณหภูมิ และสรุปอาหารไปยังแชทที่ครอบครัวเลือก"
            : "การเชื่อมต่อนี้เป็นของคุณเท่านั้น สมาชิกคนอื่นมี LINE และการตั้งค่าของตัวเอง"
          : fridgeId
            ? "Send fridge alerts to your chosen family chat."
            : "Only your account uses this connection. Everyone has their own settings."}
      </p>
      {error && <StatusAlert>{error}</StatusAlert>}
      {status.error && (
        <StatusAlert>
          {th ? "โหลดสถานะไม่สำเร็จ" : "Could not load connection status"}
        </StatusAlert>
      )}
      {!data ? (
        <output>{th ? "กำลังโหลด…" : "Loading…"}</output>
      ) : !data.ready ? (
        <p className="setup-note">
          {th
            ? "ผู้ดูแลยังไม่ได้เปิดใช้งาน LINE สำหรับระบบนี้ คุณสามารถตั้งค่าการแจ้งเตือนรอไว้ได้"
            : "LINE has not been enabled by the administrator yet. You can still save your preferences."}
        </p>
      ) : data.linked ? (
        <div className="form-actions">
          {manage && (
            <>
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
                className="secondary"
                disabled={busy}
                onClick={() => void action("disconnect")}
              >
                <Unplug size={17} aria-hidden="true" />
                {th ? "ตัดการเชื่อมต่อ" : "Disconnect"}
              </button>
            </>
          )}
        </div>
      ) : manage ? (
        <>
          <div className="line-steps">
            <div>
              <h3>
                {th ? "1. เพิ่ม FoodWarden ใน LINE" : "1. Add FoodWarden in LINE"}
              </h3>
              <p>
                {th
                  ? fridgeId
                    ? "เพิ่มเพื่อนบอท แล้วเชิญบอทเข้ากลุ่มครอบครัวที่ต้องการแจ้งเตือน"
                    : "เพิ่มเพื่อนบอท FoodWarden เพื่อรับการแจ้งเตือนส่วนตัว"
                  : fridgeId
                    ? "Add the bot, then invite it to your family group."
                    : "Add the FoodWarden bot for private notifications."}
              </p>
              {data.friend_url ? (
                <>
                  <a
                    className="primary"
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
                    title={
                      th
                        ? "สแกนเพื่อเพิ่มเพื่อน FoodWarden"
                        : "Scan to add FoodWarden"
                    }
                  />
                </>
              ) : (
                <p className="small">
                  {th
                    ? "ผู้ดูแลต้องเพิ่มลิงก์บอทก่อนแสดง QR code หากเพิ่มเพื่อนแล้ว สามารถใช้รหัสด้านล่างได้เลย"
                    : "The administrator must set the bot link to show a QR code. If already added, continue below."}
                </p>
              )}
            </div>
            <div>
              <h3>{th ? "2. ส่งรหัสในแชทกับบอท" : "2. Send a code to the bot"}</h3>
              <p>
                {th
                  ? fridgeId
                    ? "ส่งในกลุ่มที่เชิญบอทแล้ว หรือแชทกับบอทโดยตรง"
                    : "ส่งในแชทส่วนตัวกับบอทเท่านั้น ไม่ส่งรหัสส่วนตัวในกลุ่ม"
                  : fridgeId
                    ? "Send it in the group or directly to the bot."
                    : "Send personal codes in a direct chat, never in a group."}
              </p>
              {code && seconds > 0 ? (
                <>
                  <div className="pairing-code">
                    <code>{code.code}</code>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(code.code)
                          .then(() =>
                            toast.success(th ? "คัดลอกรหัสแล้ว" : "Code copied"),
                          )
                          .catch(() =>
                            toast.error(
                              th
                                ? "คัดลอกไม่ได้ กรุณาเลือกรหัสเพื่อคัดลอกเอง"
                                : "Select the code to copy it manually",
                            ),
                          )
                      }
                    >
                      <Copy size={17} aria-hidden="true" />
                      {th ? "คัดลอก" : "Copy"}
                    </button>
                  </div>
                  <p className="small">
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
                </>
              ) : (
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
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
