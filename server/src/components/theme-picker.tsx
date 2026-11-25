import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    <Card aria-labelledby="display-settings-title">
      <h2 id="display-settings-title">{th ? "การแสดงผล" : "Appearance"}</h2>
      <div className="preference-fields">
        {onLanguageChange && (
          <div className="grid gap-1.5">
            <Label htmlFor="pref-language">{th ? "ภาษา" : "Language"}</Label>
            <Select
              value={language}
              onValueChange={(next) => {
                if (next === "th" || next === "en") onLanguageChange(next);
              }}
            >
              <SelectTrigger
                id="pref-language"
                aria-label={th ? "ภาษา" : "Language"}
                className="w-full justify-between"
              >
                <SelectValue>
                  {language === "th" ? "ภาษาไทย" : "English"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="th">ภาษาไทย</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {onColorThemeChange && (
          <div className="grid gap-1.5">
            <Label htmlFor="pref-color-theme">
              {th ? "โทนสี" : "Color palette"}
            </Label>
            <Select
              value={colorTheme}
              onValueChange={(next) => {
                const theme = COLOR_THEMES.find((color) => color === next);
                if (theme) onColorThemeChange(theme);
              }}
            >
              <SelectTrigger
                id="pref-color-theme"
                aria-label={th ? "โทนสี" : "Color palette"}
                className="w-full justify-between"
              >
                <SelectValue>
                  {th ? THEME_META[colorTheme].th : THEME_META[colorTheme].en}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLOR_THEMES.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {th ? THEME_META[theme].th : THEME_META[theme].en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </Card>
  );
}
