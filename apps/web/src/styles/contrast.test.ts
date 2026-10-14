import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Files whose rules must stay readable on the dark theme. Tasks 3 and 4 add the rest. */
const CHECKED = [
  "tokens.css",
  "buttons.css",
  "site.css",
  "wipe.css",
  "dialog.css",
  "account.css",
  "pricing.css",
];
/** Rules that draw shapes, never text: their background is not a text surface. Keep the reason next to each. */
const DECORATIVE = new Set<string>([
  ".wipe-line", // the 1px ember cut
  ".wipe-warm", // an image layer
  ".wipe", // an image frame
  ".wordmark .cut", // the 1px ember line in the wordmark
  ".grain", // film grain
]);

const css = (f: string) => readFileSync(join(import.meta.dirname, f), "utf8");

type RGBA = [number, number, number, number];
function parseColor(v: string): RGBA | null {
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1] as string;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = (m[1] as string)
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
  }
  return null;
}

/** Every :root block, in order; later blocks win. */
function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of css("tokens.css").matchAll(/:root\s*\{([^}]*)\}/g))
    for (const decl of (block[1] as string).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      map.set(decl[1] as string, (decl[2] as string).trim());
  return map;
}
const T = tokens();
function resolve(v: string, depth = 0): string {
  return depth > 8
    ? v
    : v.replace(/var\((--[\w-]+)\)/g, (_, n: string) => resolve(T.get(n) ?? "", depth + 1));
}
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}
function lum([r, g, b]: RGBA): number {
  const c = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const page = parseColor(resolve("var(--bg)")) as RGBA;
const ink = parseColor(resolve("var(--ink)")) as RGBA;

describe("dark theme tokens (spec §3)", () => {
  it("is a cold night with cool white ink and one ember accent (design lock)", () => {
    expect(lum(page)).toBeLessThan(0.01);
    expect(lum(ink)).toBeGreaterThan(0.8);
    expect(resolve("var(--bg)").toLowerCase()).toBe("#0b0f14");
    expect(resolve("var(--ember)").toLowerCase()).toBe("#f0a040");
    expect(resolve("var(--surface-1)").toLowerCase()).toBe("#121921");
    expect(resolve("var(--text-2)").toLowerCase()).toBe("#8c9dae");
    expect(ratio(parseColor(resolve("var(--text-2)")) as RGBA, page)).toBeGreaterThan(4.5);
    expect(
      ratio(
        parseColor(resolve("var(--on-ember)")) as RGBA,
        parseColor(resolve("var(--ember)")) as RGBA,
      ),
    ).toBeGreaterThan(4.5);
  });
  it("keeps secondary text readable on cards", () => {
    for (const t of ["--ink-2", "--mute"])
      for (const s of ["--bg", "--surface-1", "--surface-2"])
        expect(
          ratio(parseColor(resolve(`var(${t})`)) as RGBA, parseColor(resolve(`var(${s})`)) as RGBA),
          `${t} on ${s}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(CHECKED)("%s on the dark theme", (file) => {
  it("never hard-codes white", () => {
    const body = css(file).replace(/:root\s*\{[^}]*\}/g, "");
    expect(body.match(/#fff\b|#ffffff\b|:\s*white\b/gi) ?? []).toEqual([]);
  });
  it("gives every filled rule readable text (WCAG 4.5:1)", () => {
    const bad: string[] = [];
    for (const m of css(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = (m[1] as string).trim();
      if (
        sel.startsWith(":root") ||
        sel.startsWith("@") ||
        sel.includes("::before") ||
        sel.includes("::after") ||
        DECORATIVE.has(sel)
      )
        continue;
      const body = m[2] as string;
      const bgDecl = body.match(/background(?:-color)?\s*:\s*([^;]+)/)?.[1];
      if (!bgDecl) continue;
      const bg = parseColor(resolve(bgDecl).split(/\s+(?![^(]*\))/)[0] ?? "");
      if (!bg || bg[3] < 0.5) continue; // gradients, images, none, transparent, glass
      const fgDecl = body.match(/(?<![-\w])color\s*:\s*([^;]+)/)?.[1] ?? "var(--ink)";
      const fg = parseColor(resolve(fgDecl));
      if (!fg) continue;
      const surface = over(bg, page);
      const r = ratio(over(fg, surface), surface);
      if (r < 4.5) bad.push(`${sel} → ${r.toFixed(2)}`);
    }
    expect(bad).toEqual([]);
  });
});

/** Elements whose colours come from several rules. Each list is every rule that matches, in cascade order (weakest first). */
const STACKS: Record<string, string[]> = {
  "AUTO badge on the selected mode chip": [".chip", ".chip.on", ".chip .auto"],
  "AUTO badge on an unselected chip": [".chip", ".chip .auto"],
  "dark button on hover": [
    ".btn",
    ".btn-dark",
    ".btn:hover:not(:disabled)",
    ".btn-dark:hover:not(:disabled)",
  ],
  "primary button on hover": [
    ".btn",
    ".btn-primary",
    ".btn:hover:not(:disabled)",
    ".btn-primary:hover:not(:disabled)",
  ],
};

function allRules(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of CHECKED)
    for (const m of css(f)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{([^{}]*)\}/g))
      for (const sel of (m[1] as string).split(",").map((s) => s.trim()))
        map.set(sel, (map.get(sel) ?? "") + (m[2] as string));
  return map;
}

describe("colours that come from several rules", () => {
  const rules = allRules();
  it.each(Object.entries(STACKS))("%s stays readable", (_, stack) => {
    let bg: RGBA = page;
    let fg = ink;
    for (const sel of stack) {
      const body = rules.get(sel);
      if (!body) continue;
      const bgDecl = body.match(/background(?:-color)?\s*:\s*([^;]+)/)?.[1];
      const b = bgDecl ? parseColor(resolve(bgDecl).split(/\s+(?![^(]*\))/)[0] ?? "") : null;
      if (b && b[3] > 0) bg = over(b, page); // a later background replaces an earlier one; transparent shows the parent
      const fgDecl = body.match(/(?<![-\w])color\s*:\s*([^;]+)/)?.[1];
      const f = fgDecl ? parseColor(resolve(fgDecl)) : null;
      if (f) fg = f;
    }
    expect(ratio(over(fg, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
