import { describe, expect, it } from "vitest";
import {
  kieInputFor,
  outputKeyFor,
  phaseOutcome,
  previewSteps,
  readySteps,
  videoSteps,
} from "../src/stories/graph.ts";
import type { StepState, StoryState } from "../src/stories/types.ts";

function state(over: Partial<StoryState> = {}): StoryState {
  const steps = Object.fromEntries([...previewSteps(), ...videoSteps()].map((s) => [s.id, s]));
  return {
    spec: {
      id: "S",
      owner: "u:1",
      userId: "1",
      kind: "human",
      scene: "cabin-wheat",
      names: null,
      date: null,
      survivorKey: "keep/S/survivor.jpg",
      infectedKey: "keep/S/infected.jpg",
      createdAt: 0,
    },
    status: "previewing",
    steps,
    picks: {},
    previewCharge: null,
    videoCharge: null,
    previewSettled: false,
    videoSettled: false,
    recomposeLeft: 1,
    output: null,
    errorCode: null,
    finishedAt: null,
    syncedSig: "",
    ...over,
  };
}
const set = (s: StoryState, id: string, st: StepState) => {
  (s.steps[id] as { state: StepState }).state = st;
};
const ids = (s: StoryState) => readySteps(s).map((x) => x.id);

describe("story graph", () => {
  it("checks the two photos (faces, age) before any keyframe is made", () => {
    const s = state();
    expect(ids(s)).toEqual(["score:sources"]);
    set(s, "score:sources", "succeeded");
    expect(ids(s)).toEqual(["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"]);
  });

  it("fails the preview when the photo check fails, before spending anything", () => {
    const s = state();
    set(s, "score:sources", "failed");
    expect(phaseOutcome(s, "preview")).toBe("failed");
    expect(ids(s)).toEqual([]);
  });

  it("scoring waits for all candidates to end, and needs one A and one C", () => {
    const s = state();
    set(s, "score:sources", "succeeded");
    set(s, "kf:A:1", "succeeded");
    set(s, "kf:C:1", "succeeded");
    set(s, "kf:A:2", "pending");
    set(s, "kf:C:2", "failed");
    expect(ids(s)).not.toContain("score:AC");
    set(s, "kf:A:2", "failed");
    expect(ids(s)).toEqual(["score:AC"]);
  });

  it("preview fails as soon as every candidate of one frame failed", () => {
    const s = state();
    set(s, "score:sources", "succeeded");
    for (const id of ["kf:A:1", "kf:A:2"]) set(s, id, "failed");
    set(s, "kf:C:1", "pending");
    expect(phaseOutcome(s, "preview")).toBe("failed");
  });

  it("preview succeeds once scoring succeeded", () => {
    const s = state();
    set(s, "score:sources", "succeeded");
    for (const id of ["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"]) set(s, id, "succeeded");
    expect(phaseOutcome(s, "preview")).toBe("running");
    set(s, "score:AC", "succeeded");
    expect(phaseOutcome(s, "preview")).toBe("succeeded");
  });

  it("video steps are never ready during the preview", () => {
    expect(readySteps(state()).some((x) => x.phase === "video")).toBe(false);
  });

  it("in the video phase shots 3 and 5 wait for keyframe B and compose waits for every shot", () => {
    const s = state({ status: "rendering", picks: { A: "kf/S/a.jpg", C: "kf/S/c.jpg" } });
    for (const id of ["score:sources", "kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2", "score:AC"])
      set(s, id, "succeeded");
    expect(ids(s).sort()).toEqual(["kf:B", "shot:1", "shot:2", "shot:4"]);
    set(s, "kf:B", "succeeded");
    expect(ids(s)).toContain("shot:3");
    expect(ids(s)).toContain("shot:5");
    for (const id of ["shot:1", "shot:2", "shot:3", "shot:4", "shot:5"]) set(s, id, "succeeded");
    expect(ids(s)).toEqual(["compose"]);
  });

  it("video fails as soon as one step fails", () => {
    const s = state({ status: "rendering" });
    set(s, "shot:2", "failed");
    expect(phaseOutcome(s, "video")).toBe("failed");
  });

  it("builds kie inputs from the photos, the picks and keyframe B", async () => {
    const s = state({ status: "rendering", picks: { A: "kf/S/a.jpg", C: "kf/S/c.jpg" } });
    (s.steps["kf:B"] as { outputKey: string | null }).outputKey = "kf/S/kf-B.jpg";
    const url = async (k: string) => `https://r2/${k}`;
    const a = await kieInputFor(s.steps["kf:A:2"]!, s, url);
    expect(a.images).toEqual(["https://r2/keep/S/survivor.jpg", "https://r2/keep/S/infected.jpg"]);
    expect(a.prompt).toContain("IMAGE 1 is the survivor");
    const b = await kieInputFor(s.steps["kf:B"]!, s, url);
    expect(b.images).toEqual([
      "https://r2/keep/S/survivor.jpg",
      "https://r2/keep/S/infected.jpg",
      "https://r2/kf/S/a.jpg",
      "https://r2/kf/S/c.jpg",
    ]);
    const shot3 = await kieInputFor(s.steps["shot:3"]!, s, url);
    expect(shot3).toMatchObject({
      first: "https://r2/kf/S/a.jpg",
      last: "https://r2/kf/S/kf-B.jpg",
      targetSec: 3,
    });
    const shot4 = await kieInputFor(s.steps["shot:4"]!, s, url);
    expect(shot4.first).toBe("https://r2/kf/S/c.jpg");
    expect(shot4.last).toBeUndefined();
  });

  it("names outputs by story and step", () => {
    expect(outputKeyFor("S", "kf:A:1", "jpg")).toBe("kf/S/kf-A-1.jpg");
    expect(outputKeyFor("S", "shot:3", "mp4")).toBe("shot/S/shot-3.mp4");
  });
});
