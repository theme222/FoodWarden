import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { StatusAlert } from "@/components/status-alert";
import { ThemeLanguagePicker } from "@/components/theme-picker";
import type { ColorTheme } from "@/state/dashboard-machine";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("ThemeLanguagePicker renders language and color palette selectors", () => {
  function ThemeProbe() {
    const [color, setColor] = useState<ColorTheme>("green");
    return (
      <ThemeLanguagePicker
        language="en"
        colorTheme={color}
        onLanguageChange={() => {}}
        onColorThemeChange={setColor}
      />
    );
  }

  render(<ThemeProbe />);
  expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Color palette" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Layout" })).toBeNull();
});

test("StatusAlert exposes accessible alert vs status semantic roles cleanly", () => {
  render(
    <div>
      <StatusAlert variant="destructive">High temp</StatusAlert>
      <StatusAlert variant="success">All devices online</StatusAlert>
    </div>,
  );
  expect(screen.getByRole("alert").textContent).toContain("High temp");
  expect(screen.getByRole("status").textContent).toContain(
    "All devices online",
  );
});
