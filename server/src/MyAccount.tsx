import { useState } from "react";
import type { FormEvent } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import type { Language } from "./model";
import { LineConnection } from "./LineConnection";
import { useLineStatus, lineAction } from "./line-data";
import { ThemeLanguagePicker } from "./components/theme-picker";
import type { ColorTheme } from "./state/dashboard-machine";

const copy = {
  th: {
    title: "ของฉัน",
    description:
      "LINE และการแจ้งเตือนเฉพาะคุณ การเปลี่ยนที่นี่ไม่กระทบคนอื่นในบ้าน",
    notifications: "การแจ้งเตือนของฉัน",
    morning: "สรุปตอนเช้า",
    morningEnabled: "ส่งสรุปให้ฉันทุกเช้า",
    time: "เวลา (ประเทศไทย)",
    morningHelp:
      "รวมอาหารใกล้หมดอายุ ของโปรด และสถานะจากทุกตู้ที่คุณเป็นสมาชิก หากไม่มีเรื่องให้รายงานจะไม่ส่ง",
    instant: "แจ้งทันทีเมื่อ",
    obstruct: "ประตูมีสิ่งกีดขวางหรืออุปกรณ์ผิดปกติ",
    warm: "ตู้เย็นร้อนเกินไป",
    spoil: "ค่า VOC สูง อาหารอาจเริ่มเสีย",
    saving: "กำลังบันทึก…",
    save: "บันทึกการแจ้งเตือน",
    saved: "บันทึกการแจ้งเตือนแล้ว",
    saveError: "บันทึกไม่ได้ กรุณาลองใหม่",
  },
  en: {
    title: "Me",
    description:
      "Your LINE and notification preferences. Changes here do not affect anyone else.",
    notifications: "My notifications",
    morning: "Morning summary",
    morningEnabled: "Send me a morning summary",
    time: "Time (Asia/Bangkok)",
    morningHelp:
      "Includes expiring food, favorites and activity from your fridges. Days with nothing to report are skipped.",
    instant: "Tell me right away when",
    obstruct: "Door obstruction or a device fault",
    warm: "The fridge gets too warm",
    spoil: "High VOC suggests possible spoilage",
    saving: "Saving…",
    save: "Save preferences",
    saved: "Notification preferences saved",
    saveError: "Could not save preferences",
  },
};

type Preferences = {
  morning_enabled: boolean;
  morning_time: string;
  inst_obstruct: boolean;
  inst_warm: boolean;
  inst_spoil: boolean;
};

function useNotificationPreferences(language: Language) {
  const profile = useLineStatus("/api/me/line");
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const t = copy[language];
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
      toast.success(t.saved);
    } catch {
      toast.error(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  return { profile, value, busy, change, save };
}

function NotificationPreferences({ language }: { language: Language }) {
  const { profile, value, busy, change, save } =
    useNotificationPreferences(language);
  const t = copy[language];
  const alerts = [
    ["inst_obstruct", t.obstruct],
    ["inst_warm", t.warm],
    ["inst_spoil", t.spoil],
  ] as const;

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="panel notification-preferences flex flex-col gap-3"
    >
      <h2 className="flex items-center gap-2">
        <Clock size={20} aria-hidden="true" /> {t.notifications}
      </h2>
      <fieldset disabled={busy || !profile.data}>
        <div className="subblock">
          <h3>{t.morning}</h3>
          <label className="chk">
            <span>{t.morningEnabled}</span>
            <input
              type="checkbox"
              checked={value.morning_enabled}
              onChange={(e) => change("morning_enabled", e.target.checked)}
            />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {t.time}
            <input
              type="time"
              pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
              placeholder="HH:mm"
              value={value.morning_time}
              disabled={!value.morning_enabled}
              onChange={(e) => change("morning_time", e.target.value)}
              required
            />
          </label>
          <p className="small">{t.morningHelp}</p>
        </div>

        <div className="subblock">
          <h3>{t.instant}</h3>
          {alerts.map(([key, label]) => (
            <label className="chk" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
            </label>
          ))}
        </div>

        <div>
          <button type="submit" className="primary">
            {busy ? t.saving : t.save}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function MyAccount({
  language,
  colorTheme = "green",
  onLanguageChange,
  onColorThemeChange,
}: {
  language: Language;
  colorTheme?: ColorTheme;
  onLanguageChange?: (next: Language) => void;
  onColorThemeChange?: (next: ColorTheme) => void;
}) {
  const t = copy[language];
  return (
    <div className="settings">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>{t.title}</h1>
          <p className="sub">{t.description}</p>
        </div>
      </div>
      <ThemeLanguagePicker
        language={language}
        colorTheme={colorTheme}
        onLanguageChange={onLanguageChange}
        onColorThemeChange={onColorThemeChange}
      />
      <LineConnection language={language} />
      <NotificationPreferences language={language} />
    </div>
  );
}
