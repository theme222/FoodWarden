import type { Language } from "@/model";
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
        {onColorThemeChange && (
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
      </div>
    </section>
  );
}
