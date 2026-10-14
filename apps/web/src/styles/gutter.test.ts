import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const files = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  );

/** Classes that share an element with .wrap, e.g. class="wrap not-found". */
const partners = new Set(
  files(SRC, ".astro").flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/class="wrap ([\w\s-]+)"/g)].flatMap((m) =>
      (m[1] as string).split(/\s+/),
    ),
  ),
);
const css = files(join(SRC, "styles"), ".css")
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("page gutters (spec 3: 16px+ side gutter at phone width)", () => {
  it("never lets a class on a .wrap element zero the side padding", () => {
    const bad: string[] = [];
    for (const cls of partners)
      for (const m of css.matchAll(new RegExp(`(?:^|\\n)\\s*\\.${cls}\\s*\\{([^}]*)\\}`, "g")))
        if (/(?:^|;|\s)padding\s*:\s*(?:0|[\d.]+\w*\s+0(?:\s+[\d.]+\w*)?)\s*;/.test(m[1] as string))
          bad.push(`.${cls}`);
    expect(bad).toEqual([]);
  });
  it("uses the 16px phone gutter from the design lock", () => {
    const tokens = readFileSync(join(SRC, "styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--gutter:\s*16px/);
    expect(tokens).toMatch(/\.wrap\s*\{[^}]*padding:\s*0 var\(--gutter\)/);
  });
});
