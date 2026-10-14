import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const sheets = readdirSync(dir).filter((f) => f.endsWith(".css"));
const read = (f: string) => readFileSync(join(dir, f), "utf8");

/** Looping animations that repaint, each with the reason it is allowed. */
const REPAINTS: Record<string, string> = {
  "btn-spin": "one running-light button, inside a section that is skipped while off screen",
};
const CHEAP = new Set(["opacity", "transform", "translate", "scale", "rotate"]);

describe("animations stay cheap on slow machines (CI on 2 CPUs starved the workspace)", () => {
  it("only animates opacity and transform, which the compositor can do without repainting", () => {
    const bad: string[] = [];
    for (const f of sheets)
      for (const m of read(f).matchAll(/@keyframes ([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
        const name = m[1] as string;
        const props = [...(m[2] as string).matchAll(/([\w-]+)\s*:/g)].map((p) => p[1] as string);
        const costly = props.filter((p) => !CHEAP.has(p));
        if (costly.length > 0 && !(name in REPAINTS))
          bad.push(`${f} ${name}: ${[...new Set(costly)].join(", ")}`);
      }
    expect(bad).toEqual([]);
  });
  it("skips drawing (and animating) the sections below the hero while they are off screen", () => {
    expect(read("tokens.css")).toMatch(
      /\.section\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto \d+px/,
    );
  });
});
