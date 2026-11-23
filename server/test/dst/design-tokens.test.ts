import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { CHART_SERIES } from "../../src/state/dashboard-machine";

type VarMap = Record<string, string>;

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelLum(channel8: number): number {
  const srgb = channel8 / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function extractCssVars(css: string, blockHeader: string): VarMap {
  const idx = css.indexOf(blockHeader);
  if (idx < 0) throw new Error(`Missing CSS block: ${blockHeader}`);
  const open = css.indexOf("{", idx);
  let depth = 0;
  let close = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) throw new Error(`Unclosed CSS block: ${blockHeader}`);
  const body = css.slice(open + 1, close);
  const vars: VarMap = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) {
    vars[match[1]!] = match[2]!;
  }
  return vars;
}

function getVar(vars: VarMap, name: string): string {
  const val = vars[name];
  if (!val) throw new Error(`Missing CSS hex token ${name}`);
  return val;
}

test("Design Tokens: all v2 palettes (green, blue, pink) and v1 rollback meet WCAG AA (>=4.5:1) contrast", () => {
  const uiThemeCss = readFileSync(
    resolve(import.meta.dirname, "../../src/ui-theme.css"),
    "utf8",
  );
  const v1Css = readFileSync(
    resolve(import.meta.dirname, "../../src/v1-classic.css"),
    "utf8",
  );

  const greenRoot = extractCssVars(uiThemeCss, ":root {");
  const themes: Record<string, VarMap> = {
    green: greenRoot,
    blue: {
      ...greenRoot,
      ...extractCssVars(uiThemeCss, ':root[data-color="blue"] {'),
    },
    pink: {
      ...greenRoot,
      ...extractCssVars(uiThemeCss, ':root[data-color="pink"] {'),
    },
    v1: {
      ...greenRoot,
      ...extractCssVars(v1Css, ':root[data-ui="v1"] {'),
    },
  };

  for (const [themeName, vars] of Object.entries(themes)) {
    const surface = getVar(vars, "--surface");
    const surface2 = getVar(vars, "--surface-2");
    const bg = getVar(vars, "--bg");

    const pairs: Array<[string, string, string, number]> = [
      ["--ink", "--bg", "body on canvas", 4.5],
      ["--ink", "--surface", "body on card", 4.5],
      ["--ink", "--surface-2", "body on inset", 4.5],
      ["--muted-ink", "--bg", "muted on canvas", 4.5],
      ["--muted-ink", "--surface", "muted on card", 4.5],
      ["--muted-ink", "--surface-2", "muted on inset", 4.5],
      ["--leaf", "--bg", "accent link on canvas", 4.5],
      ["--leaf", "--surface", "accent link on card", 4.5],
      ["--on-dark", "--dark", "text on primary dark", 4.5],
      ["--on-dark-2", "--dark", "accent on dark", 4.5],
      ["--lime-ink", "--lime", "ink on lime pill", 4.5],
      ["--lime-ink", "--lime-soft", "ink on soft lime", 4.5],
      ["--bad-ink", "--bad-surface", "alert text on soft blush", 4.5],
      ["--bad-ink", "--bad-soft", "alert text on soft pill", 4.5],
      ["--on-bad", "--bad", "white on bad pill/button", 4.5],
      ["--soon-ink", "--soon-surface", "warning ink on soft amber", 4.5],
      ["--on-soon", "--soon-pill-bg", "warning ink on soon pill", 4.5],
      ["--fresh-ink", "--fresh-surface", "fresh ink on soft sage", 4.5],
      ["--on-fresh", "--fresh", "white on fresh solid", 4.5],
      ["--take-ink", "--take-soft", "take-out icon ink", 4.5],
      ["--edit-ink", "--edit-soft", "edit icon ink", 4.5],
    ];

    if (themeName !== "v1") {
      pairs.push(["--lime-ink", "--hero-bg", "login hero headline on hero-bg", 4.5]);
    }

    for (const [fgKey, bgKey, desc, minRatio] of pairs) {
      const ratio = contrastRatio(getVar(vars, fgKey), getVar(vars, bgKey));
      expect(
        ratio,
        `${themeName} (${desc}: ${fgKey} on ${bgKey}) = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(minRatio);
    }

    const whiteOnTake = contrastRatio("#ffffff", getVar(vars, "--take"));
    expect(whiteOnTake, `${themeName} white on --take`).toBeGreaterThanOrEqual(4.5);

    for (const series of CHART_SERIES) {
      const ratioOnInset = contrastRatio(series.textColor, surface2);
      const ratioOnCard = contrastRatio(series.textColor, surface);
      expect(
        ratioOnInset,
        `${themeName} chart ${series.key} label on surface-2`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioOnCard,
        `${themeName} chart ${series.key} label on surface`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    // Color-restraint guardrail: calm alert & warning containers must stay bright/soft pastel (L >= 0.80)
    // so full-width warnings never produce harsh red/amber eye-strain walls.
    expect(relativeLuminance(getVar(vars, "--bad-surface"))).toBeGreaterThanOrEqual(
      0.8,
    );
    expect(relativeLuminance(getVar(vars, "--soon-surface"))).toBeGreaterThanOrEqual(
      0.8,
    );
    expect(relativeLuminance(bg)).toBeGreaterThanOrEqual(0.8);
  }
});
