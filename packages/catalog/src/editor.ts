import type { LocalStep } from "./tools.ts";

/** Editor spec 1.1: the filters; each is a 4×5 colour matrix in FILTERS. */
export const FILTER_IDS = [
  "grayscale",
  "sepia",
  "vintage",
  "invert",
  "cool",
  "warm",
  "high-contrast",
  "fade",
] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const ADJUST_KEYS = ["brightness", "contrast", "saturation", "warmth", "exposure"] as const;
export type AdjustValues = Record<(typeof ADJUST_KEYS)[number], number>;
export const NEUTRAL_ADJUST: AdjustValues = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  exposure: 0,
};

/**
 * Editor spec 1.1. Lengths (radius, size) are shares of the picture's short side, so a 1600 px
 * preview and a 6000 px download look the same. Colours are #rrggbb.
 */
export type EditStep =
  | LocalStep
  | ({ op: "adjust" } & AdjustValues)
  | { op: "filter"; name: FilterId; amount: number }
  | { op: "hue"; shift: number }
  | { op: "replace-color"; from: string; to: string; tolerance: number; softness: number }
  | { op: "blur"; radius: number }
  | { op: "border"; size: number; color: string }
  | { op: "round"; radius: number };
export type EditOp = EditStep["op"];

/** Editor spec 1.1 / 2.4: every range, default and size the editor and its tests use. */
export const EDITOR_LIMITS = {
  adjust: { min: -100, max: 100, step: 1, default: 0 },
  filterAmount: { min: 0, max: 100, step: 1, default: 100 },
  hue: { min: -180, max: 180, step: 1, default: 0 },
  /** CIE76 ΔE: a tolerance of 20 takes in clearly the same colour, shaded. */
  tolerance: { min: 0, max: 100, step: 1, default: 20 },
  softness: { min: 0, max: 100, step: 1, default: 10 },
  blur: { min: 0, max: 0.05, step: 0.001, default: 0.01 },
  border: { min: 0, max: 0.2, step: 0.005, default: 0.04 },
  round: { min: 0, max: 0.5, step: 0.005, default: 0.06 },
  previewLongEdge: 1600,
  dragLongEdge: 800,
  thumbLongEdge: 96,
  paletteColors: 8,
  maxHistory: 100,
  savedHours: 24,
  /** How long after the last change the document is written to IndexedDB. */
  saveDelayMs: 1000,
} as const;

/** Editor spec 2.1: 4×5 row-major matrices on 0–1 values; the fifth column is an offset. */
export const FILTERS: Record<FilterId, readonly number[]> = {
  grayscale: [
    0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0, 0,
    0, 1, 0,
  ],
  sepia: [
    0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0,
  ],
  vintage: [
    0.5, 0.4, 0.15, 0, 0.06, 0.3, 0.55, 0.1, 0, 0.05, 0.2, 0.35, 0.3, 0, 0.06, 0, 0, 0, 1, 0,
  ],
  invert: [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0],
  cool: [0.9, 0, 0, 0, 0, 0, 1, 0, 0, 0.02, 0, 0, 1.1, 0, 0.04, 0, 0, 0, 1, 0],
  warm: [1.1, 0, 0, 0, 0.04, 0, 1, 0, 0, 0.02, 0, 0, 0.9, 0, 0, 0, 0, 0, 1, 0],
  "high-contrast": [1.4, 0, 0, 0, -0.2, 0, 1.4, 0, 0, -0.2, 0, 0, 1.4, 0, -0.2, 0, 0, 0, 1, 0],
  fade: [0.8, 0.05, 0.05, 0, 0.1, 0.05, 0.8, 0.05, 0, 0.1, 0.05, 0.05, 0.8, 0, 0.1, 0, 0, 0, 1, 0],
};

/** Part 1 tools; part 2 adds text, draw and crop. */
export const EDITOR_TOOL_IDS = ["adjust", "filter", "color", "blur", "frame", "picker"] as const;
export type EditorToolId = (typeof EDITOR_TOOL_IDS)[number];

export const EDITOR_PAGE_IDS = [
  "color-picker-from-image",
  "invert-image",
  "blur-image",
  "black-and-white-photo",
  "change-color-of-image",
  "sepia-filter",
  "add-border-to-image",
  "brighten-image",
  "rounded-corners-image",
] as const;
export type EditorPageId = (typeof EDITOR_PAGE_IDS)[number];

export type EditorPage = {
  tool: EditorToolId;
  steps: readonly EditStep[];
  /** Editor spec 3.4: only the picker loads first; the other tools load when clicked. */
  pickerOnly: boolean;
};

const page = (tool: EditorToolId, steps: readonly EditStep[] = []): EditorPage => ({
  tool,
  steps,
  pickerOnly: false,
});

/** Editor spec 3.4: which tool a task page opens and what is already applied. */
export const EDITOR_PAGES: Record<EditorPageId, EditorPage> = {
  "color-picker-from-image": { tool: "picker", steps: [], pickerOnly: true },
  "invert-image": page("filter", [{ op: "filter", name: "invert", amount: 100 }]),
  "blur-image": page("blur", [{ op: "blur", radius: EDITOR_LIMITS.blur.default }]),
  "black-and-white-photo": page("filter", [{ op: "filter", name: "grayscale", amount: 100 }]),
  "change-color-of-image": page("color"),
  "sepia-filter": page("filter", [{ op: "filter", name: "sepia", amount: 100 }]),
  "add-border-to-image": page("frame", [
    { op: "border", size: EDITOR_LIMITS.border.default, color: "#ffffff" },
  ]),
  "brighten-image": page("adjust", [
    { op: "adjust", brightness: 20, contrast: 0, saturation: 0, warmth: 0, exposure: 0 },
  ]),
  "rounded-corners-image": page("frame", [{ op: "round", radius: EDITOR_LIMITS.round.default }]),
};
