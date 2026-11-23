import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { StatusAlert } from "@/components/status-alert";
import { ThemeLanguagePicker } from "@/components/theme-picker";
import { UiVersionProvider, useUiVersion } from "@/components/ui-version-context";
import type { ColorTheme } from "@/state/dashboard-machine";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.dataset.ui = "v2";
  globalThis.fetch = originalFetch;
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function ThemeProbe() {
  const [color, setColor] = useState<ColorTheme>("green");
  const { version } = useUiVersion();
  return (
    <div>
      <output data-testid="ver">{version}</output>
      <ThemeLanguagePicker
        language="en"
        colorTheme={color}
        onLanguageChange={() => {}}
        onColorThemeChange={setColor}
      />
    </div>
  );
}

test("UI Version flag defaults to v2, supports v1 rollback toggle, and hides v2 palettes under v1", async () => {
  globalThis.fetch = Object.assign(
    async () => json({ defaultVersion: "v2", locked: false }),
    { preconnect: originalFetch.preconnect },
  );

  render(
    <UiVersionProvider>
      <ThemeProbe />
    </UiVersionProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId("ver").textContent).toBe("v2");
    expect(document.documentElement.dataset.ui).toBe("v2");
  });

  // v2 color palettes are shown initially
  expect(screen.getByRole("combobox", { name: "Color palette" })).toBeTruthy();

  const user = userEvent.setup({ document });
  await user.selectOptions(screen.getByRole("combobox", { name: "Layout" }), "v1");

  expect(document.documentElement.dataset.ui).toBe("v1");
  expect(localStorage.getItem("foodwarden_ui_version")).toBe("v1");
  expect(screen.queryByRole("combobox", { name: "Color palette" })).toBeNull();

  await user.selectOptions(screen.getByRole("combobox", { name: "Layout" }), "v2");
  expect(document.documentElement.dataset.ui).toBe("v2");
  expect(localStorage.getItem("foodwarden_ui_version")).toBe("v2");
});

test("UI_VERSION_LOCK from /api/ui/config overrides query and disables the layout selector", async () => {
  window.history.replaceState(null, "", "/?ui=v2");
  globalThis.fetch = Object.assign(
    async () => json({ defaultVersion: "v1", locked: true }),
    { preconnect: originalFetch.preconnect },
  );

  render(
    <UiVersionProvider>
      <ThemeProbe />
    </UiVersionProvider>,
  );

  await waitFor(() => {
    expect(document.documentElement.dataset.ui).toBe("v1");
  });

  const layout = screen.getByRole("combobox", { name: "Layout" }) as HTMLSelectElement;
  expect(layout.disabled).toBe(true);
});

test("StatusAlert exposes accessible alert vs status semantic roles cleanly", () => {
  render(
    <div>
      <StatusAlert variant="destructive">High temp</StatusAlert>
      <StatusAlert variant="success">All devices online</StatusAlert>
    </div>,
  );
  expect(screen.getByRole("alert").textContent).toContain("High temp");
  expect(screen.getByRole("status").textContent).toContain("All devices online");
});
