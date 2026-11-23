import { localTimestamp } from "../model";
import type { Language } from "../model";

const RELATIVE_FORMATTERS: Record<Language, Intl.RelativeTimeFormat> = {
  th: new Intl.RelativeTimeFormat("th", { numeric: "always" }),
  en: new Intl.RelativeTimeFormat("en", { numeric: "always" }),
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
  const format = RELATIVE_FORMATTERS[language];
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
