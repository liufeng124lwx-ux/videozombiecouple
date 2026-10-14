import type { Kind, SceneId } from "@vzc/catalog";
import type { StoryView } from "@vzc/contracts";
import type { FaceVerdict } from "./faces.ts";

export type Slot = "survivor" | "infected";
export type Photo = { jpeg: Blob; url: string; face: FaceVerdict | "skipped" };

/** The tool's screens (design lock "Tool states"). */
export type Phase =
  | "setup"
  | "uploading"
  | "previewing"
  | "preview_ready"
  | "paying"
  | "rendering"
  | "done"
  | "preview_failed"
  | "failed";

export type ToolState = {
  kind: Kind;
  photos: Record<Slot, Photo | null>;
  checking: Record<Slot, boolean>;
  scene: SceneId;
  title: { names: string; date: string };
  phase: Phase;
  storyId: string | null;
  story: StoryView | null;
  /** An API error code or a photo problem, shown in plain words by the UI. */
  error: string | null;
};

export type ToolEvent =
  | { type: "kind"; kind: Kind }
  | { type: "checking"; slot: Slot }
  | { type: "photo"; slot: Slot; photo: Photo }
  | { type: "photoError"; slot: Slot; code: string }
  | { type: "swap" }
  | { type: "scene"; scene: SceneId }
  | { type: "title"; names: string; date: string }
  | { type: "submit" }
  | { type: "created"; storyId: string }
  | { type: "resume"; storyId: string }
  | { type: "view"; view: StoryView }
  | { type: "pay" }
  | { type: "cancelPay" }
  | { type: "rendering" }
  | { type: "error"; code: string }
  | { type: "reset" };

export function initialState(over: Partial<Pick<ToolState, "kind" | "scene">> = {}): ToolState {
  return {
    kind: over.kind ?? "human",
    photos: { survivor: null, infected: null },
    checking: { survivor: false, infected: false },
    scene: over.scene ?? "cabin-wheat",
    title: { names: "", date: "" },
    phase: "setup",
    storyId: null,
    story: null,
    error: null,
  };
}

const usable = (p: Photo | null) =>
  p !== null &&
  (p.face === "ok" || p.face === "unknown" || p.face === "skipped" || p.face === "small");

/** Two photos, each with one clear face (the pet photo is not checked), nothing still loading. */
export function canSubmit(s: ToolState): boolean {
  return (
    s.phase === "setup" &&
    !s.checking.survivor &&
    !s.checking.infected &&
    usable(s.photos.survivor) &&
    usable(s.photos.infected)
  );
}

const PHASE_OF: Record<StoryView["status"], Phase> = {
  previewing: "previewing",
  preview_ready: "preview_ready",
  preview_failed: "preview_failed",
  rendering: "rendering",
  done: "done",
  failed: "failed",
};

export function reduce(s: ToolState, e: ToolEvent): ToolState {
  switch (e.type) {
    case "kind": {
      if (s.phase !== "setup" || e.kind === s.kind) return s;
      // The second photo is a person in one version and a pet in the other.
      return { ...s, kind: e.kind, photos: { ...s.photos, infected: null }, error: null };
    }
    case "checking":
      return { ...s, checking: { ...s.checking, [e.slot]: true }, error: null };
    case "photo":
      return {
        ...s,
        photos: { ...s.photos, [e.slot]: e.photo },
        checking: { ...s.checking, [e.slot]: false },
      };
    case "photoError":
      return {
        ...s,
        photos: { ...s.photos, [e.slot]: null },
        checking: { ...s.checking, [e.slot]: false },
        error: e.code,
      };
    case "swap":
      if (s.kind === "pet" || s.phase !== "setup") return s;
      return { ...s, photos: { survivor: s.photos.infected, infected: s.photos.survivor } };
    case "scene":
      return { ...s, scene: e.scene };
    case "title":
      return { ...s, title: { names: e.names, date: e.date } };
    case "submit":
      return canSubmit(s) ? { ...s, phase: "uploading", error: null } : s;
    case "created":
      return { ...s, storyId: e.storyId, phase: "previewing" };
    case "resume":
      return { ...s, storyId: e.storyId, phase: "previewing", error: null };
    case "view": {
      if (s.storyId && e.view.id !== s.storyId) return s;
      const next = PHASE_OF[e.view.status];
      // While the person picks a pack, polls that still say "preview_ready" keep the picker open.
      const phase = s.phase === "paying" && next === "preview_ready" ? "paying" : next;
      return {
        ...s,
        story: e.view,
        phase,
        kind: e.view.kind,
        scene: e.view.scene,
        error: e.view.errorCode,
      };
    }
    case "pay":
      return s.phase === "preview_ready" ? { ...s, phase: "paying" } : s;
    case "cancelPay":
      return s.phase === "paying" ? { ...s, phase: "preview_ready" } : s;
    case "rendering":
      return { ...s, phase: "rendering", error: null };
    case "error":
      // Before a story exists, go back to the setup with the photos kept.
      return s.storyId ? { ...s, error: e.code } : { ...s, phase: "setup", error: e.code };
    case "reset":
      return initialState({ kind: s.kind, scene: s.scene });
  }
}
