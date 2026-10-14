import type { StoryView } from "@vzc/contracts";
import { describe, expect, it } from "vitest";
import { canSubmit, initialState, reduce, type ToolState } from "./machine.ts";

const photo = (face: "ok" | "none" | "many" | "unknown" | "skipped" = "ok") => ({
  jpeg: new Blob(["x"]),
  url: "blob:x",
  face,
});
const view = (status: StoryView["status"], over: Partial<StoryView> = {}): StoryView => ({
  id: "S1",
  status,
  kind: "human",
  scene: "cabin-wheat",
  names: null,
  date: null,
  preview: null,
  video: null,
  progress: { done: 0, total: 5, etaMs: null },
  errorCode: null,
  recomposeLeft: 1,
  createdAt: 0,
  ...over,
});
const run = (events: Parameters<typeof reduce>[1][], start: ToolState = initialState()) =>
  events.reduce(reduce, start);

describe("story tool machine", () => {
  it("needs two photos with one clear face each before the preview", () => {
    let s = initialState();
    expect(canSubmit(s)).toBe(false);
    s = run([{ type: "photo", slot: "survivor", photo: photo() }], s);
    expect(canSubmit(s)).toBe(false);
    s = run([{ type: "photo", slot: "infected", photo: photo("many") }], s);
    expect(canSubmit(s)).toBe(false);
    s = run([{ type: "photo", slot: "infected", photo: photo("unknown") }], s);
    expect(canSubmit(s)).toBe(true);
  });

  it("swaps who turns, but not in the pet version", () => {
    const a = photo();
    const b = { ...photo(), url: "blob:b" };
    let s = run([
      { type: "photo", slot: "survivor", photo: a },
      { type: "photo", slot: "infected", photo: b },
      { type: "swap" },
    ]);
    expect(s.photos.survivor?.url).toBe("blob:b");
    s = run([{ type: "kind", kind: "pet" }, { type: "swap" }], s);
    expect(s.kind).toBe("pet");
    expect(s.photos.survivor?.url).toBe("blob:b");
  });

  it("switching to the pet version drops a human photo from the pet slot", () => {
    const s = run([
      { type: "photo", slot: "infected", photo: photo() },
      { type: "kind", kind: "pet" },
    ]);
    expect(s.photos.infected).toBeNull();
  });

  it("follows the story through preview, payment and render", () => {
    let s = run([
      { type: "photo", slot: "survivor", photo: photo() },
      { type: "photo", slot: "infected", photo: photo() },
      { type: "submit" },
    ]);
    expect(s.phase).toBe("uploading");
    s = run(
      [
        { type: "created", storyId: "S1" },
        { type: "view", view: view("previewing") },
      ],
      s,
    );
    expect(s.phase).toBe("previewing");
    s = run([{ type: "view", view: view("preview_ready", { preview: { A: "a", C: "c" } }) }], s);
    expect(s.phase).toBe("preview_ready");
    s = run([{ type: "pay" }], s);
    expect(s.phase).toBe("paying");
    // A poll while choosing a pack must not close the pack picker.
    s = run([{ type: "view", view: view("preview_ready") }], s);
    expect(s.phase).toBe("paying");
    s = run(
      [
        { type: "view", view: view("rendering") },
        { type: "view", view: view("done") },
      ],
      s,
    );
    expect(s.phase).toBe("done");
  });

  it("resumes a running story after reload", () => {
    const s = run([
      { type: "resume", storyId: "S9" },
      { type: "view", view: view("rendering", { id: "S9" }) },
    ]);
    expect(s).toMatchObject({ storyId: "S9", phase: "rendering" });
  });

  it("shows a refund message when the video fails, and can start over", () => {
    let s = run([
      { type: "resume", storyId: "S1" },
      { type: "view", view: view("failed", { errorCode: "COMPOSE_FAILED" }) },
    ]);
    expect(s).toMatchObject({ phase: "failed", error: "COMPOSE_FAILED" });
    s = run([{ type: "reset" }], s);
    expect(s.phase).toBe("setup");
    expect(s.storyId).toBeNull();
  });

  it("keeps the photos on an upload error so the person can retry", () => {
    const s = run([
      { type: "photo", slot: "survivor", photo: photo() },
      { type: "photo", slot: "infected", photo: photo() },
      { type: "submit" },
      { type: "error", code: "NETWORK" },
    ]);
    expect(s).toMatchObject({ phase: "setup", error: "NETWORK" });
    expect(s.photos.survivor).not.toBeNull();
  });
});
