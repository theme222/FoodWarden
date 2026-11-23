import { parseColorTheme } from "./state/dashboard-machine";
import type { ColorTheme } from "./state/dashboard-machine";

const THEME_STORAGE_KEY = "foodwarden_color_theme";

export const COLOR_THEMES = ["green", "blue", "pink"] as const;

export const THEME_META: Record<
  ColorTheme,
  {
    bg: string;
    swatch: string;
    accent: string;
    th: string;
    en: string;
  }
> = {
  green: {
    bg: "#F3F6EE",
    swatch: "#CBE086",
    accent: "#386214",
    th: "เขียวธรรมชาติ",
    en: "Green",
  },
  blue: {
    bg: "#EEF4F9",
    swatch: "#9CCBF0",
    accent: "#1B5888",
    th: "ฟ้าสบายตา",
    en: "Blue",
  },
  pink: {
    bg: "#F8F0F2",
    swatch: "#F0B2C6",
    accent: "#942E52",
    th: "ชมพูละมุน",
    en: "Pink",
  },
};

export function readStoredColorTheme(): ColorTheme {
  if (typeof window === "undefined") return "green";
  try {
    return parseColorTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "green";
  }
}

export function applyColorTheme(theme: ColorTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "green") {
    root.removeAttribute("data-color");
  } else {
    root.setAttribute("data-color", theme);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", THEME_META[theme].bg);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Ignore restricted storage contexts. */
  }
}
