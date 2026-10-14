import { describe, expect, it } from "vitest";
import {
  ADJUST_KEYS,
  EDITOR_LIMITS,
  EDITOR_PAGE_IDS,
  EDITOR_PAGES,
  EDITOR_TOOL_IDS,
  type EditStep,
  FILTER_IDS,
  FILTERS,
  PAGES,
} from "../src/index.ts";

type Range = { min: number; max: number; default?: number };
const inRange = (r: Range, v: number) => v >= r.min && v <= r.max;

function valid(step: EditStep): boolean {
  const L = EDITOR_LIMITS;
  switch (step.op) {
    case "adjust":
      return ADJUST_KEYS.every((k) => inRange(L.adjust, step[k]));
    case "filter":
      return FILTER_IDS.includes(step.name) && inRange(L.filterAmount, step.amount);
    case "hue":
      return inRange(L.hue, step.shift);
    case "replace-color":
      return inRange(L.tolerance, step.tolerance) && inRange(L.softness, step.softness);
    case "blur":
      return inRange(L.blur, step.radius);
    case "border":
      return inRange(L.border, step.size) && /^#[0-9a-f]{6}$/i.test(step.color);
    case "round":
      return inRange(L.round, step.radius);
    default:
      return true;
  }
}

describe("photo editor catalog (editor spec 1)", () => {
  it("keeps every range ordered and its default inside it", () => {
    for (const r of [
      EDITOR_LIMITS.adjust,
      EDITOR_LIMITS.filterAmount,
      EDITOR_LIMITS.hue,
      EDITOR_LIMITS.tolerance,
      EDITOR_LIMITS.softness,
      EDITOR_LIMITS.blur,
      EDITOR_LIMITS.border,
      EDITOR_LIMITS.round,
    ] as Range[]) {
      expect(r.min).toBeLessThan(r.max);
      if (r.default !== undefined) expect(inRange(r, r.default)).toBe(true);
    }
    expect(EDITOR_LIMITS.dragLongEdge).toBeLessThan(EDITOR_LIMITS.previewLongEdge);
  });

  it("gives every filter a 4×5 matrix that leaves alpha alone", () => {
    for (const id of FILTER_IDS) {
      const m = FILTERS[id];
      expect(m).toHaveLength(20);
      expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });

  it("opens every editor page on a known tool with valid preset steps", () => {
    for (const id of EDITOR_PAGE_IDS) {
      const page = EDITOR_PAGES[id];
      expect(EDITOR_TOOL_IDS).toContain(page.tool);
      for (const step of page.steps) expect(valid(step)).toBe(true);
    }
    expect(EDITOR_PAGES["color-picker-from-image"]).toMatchObject({
      tool: "picker",
      pickerOnly: true,
    });
    expect(EDITOR_PAGES["invert-image"].steps).toEqual([
      { op: "filter", name: "invert", amount: 100 },
    ]);
  });

  it("names every editor page after its preset", () => {
    for (const page of PAGES.filter((p) => p.kind === "editor")) {
      expect(EDITOR_PAGE_IDS).toContain(page.editor);
      expect(page.editor).toBe(page.id);
    }
  });

  it("starts with Color Picker from Image as a draft editor page (spec 7)", () => {
    const page = PAGES.find((p) => p.id === "color-picker-from-image");
    expect(page).toMatchObject({ kind: "editor", editor: "color-picker-from-image" });
    expect(page?.locales.en).toMatchObject({
      slug: "color-picker-from-image",
      h1: "Color Picker from Image",
      status: "draft",
    });
  });
});
