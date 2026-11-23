import type { Language } from "@/model";
import { useUiVersion } from "@/components/ui-version-context";
import type { ColorTheme } from "@/state/dashboard-machine";
import { COLOR_THEMES, THEME_META } from "@/theme";

export function ThemeLanguagePicker({
  language,
  colorTheme,
  onLanguageChange,
  onColorThemeChange,
}: {
  language: Language;
  colorTheme: ColorTheme;
  onLanguageChange?: (next: Language) => void;
  onColorThemeChange?: (next: ColorTheme) => void;
}) {
  const th = language === "th";
  const { version, locked, setVersion } = useUiVersion();
  if (!onLanguageChange && !onColorThemeChange) return null;

  return (
    <section className="panel" aria-labelledby="display-settings-title">
      <h2 id="display-settings-title">{th ? "การแสดงผล" : "Appearance"}</h2>
      <div className="preference-fields">
        {onLanguageChange && (
          <label>
            <span>{th ? "ภาษา" : "Language"}</span>
            <select
              value={language}
              onChange={(e) =>
                onLanguageChange(e.target.value === "en" ? "en" : "th")
              }
            >
              <option value="th">ภาษาไทย</option>
              <option value="en">English</option>
            </select>
          </label>
        )}
        {onColorThemeChange && version === "v2" && (
          <label>
            <span>{th ? "โทนสี" : "Color palette"}</span>
            <select
              value={colorTheme}
              onChange={(e) => {
                const theme = COLOR_THEMES.find(
                  (color) => color === e.target.value,
                );
                if (theme) onColorThemeChange(theme);
              }}
            >
              {COLOR_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {th ? THEME_META[theme].th : THEME_META[theme].en}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{th ? "รูปแบบหน้าจอ" : "Layout"}</span>
          <select
            value={version}
            disabled={locked}
            onChange={(e) => setVersion(e.target.value === "v1" ? "v1" : "v2")}
          >
            <option value="v2">{th ? "ปัจจุบัน" : "Current"}</option>
            <option value="v1">{th ? "แบบเดิม" : "Classic"}</option>
          </select>
        </label>
      </div>
    </section>
  );
}
