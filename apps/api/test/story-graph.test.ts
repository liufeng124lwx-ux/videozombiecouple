import { APPEARANCE_MARK, CHRISTMAS, ZOMBIE } from "@vzc/catalog";
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
  const steps = Object.fromEntries(
    [...previewSteps(), ...videoSteps(ZOMBIE, "human")].map((s) => [s.id, s]),
  );
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
  it("before payment only the two photos are checked; nothing is generated", () => {
    const s = state();
    expect(ids(s)).toEqual(["score:sources"]);
    set(s, "score:sources", "succeeded");
    expect(ids(s)).toEqual([]);
    expect(phaseOutcome(s, "preview")).toBe("succeeded");
  });

  it("a failed photo check ends the check phase", () => {
    const s = state();
    set(s, "score:sources", "failed");
    expect(phaseOutcome(s, "preview")).toBe("failed");
    expect(ids(s)).toEqual([]);
  });

  it("after payment the keyframe candidates start first", () => {
    const s = state({ status: "rendering" });
    set(s, "score:sources", "succeeded");
    expect(ids(s)).toEqual(["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"]);
  });

  it("scoring waits for all candidates to end, and needs one A and one C", () => {
    const s = state({ status: "rendering" });
    set(s, "score:sources", "succeeded");
    set(s, "kf:A:1", "succeeded");
    set(s, "kf:C:1", "succeeded");
    set(s, "kf:A:2", "pending");
    set(s, "kf:C:2", "failed");
    expect(ids(s)).not.toContain("score:AC");
    set(s, "kf:A:2", "failed");
    expect(ids(s)).toEqual(["score:AC"]);
  });

  it("one failed candidate is fine; every candidate of a frame failing fails the film", () => {
    const s = state({ status: "rendering" });
    set(s, "score:sources", "succeeded");
    set(s, "kf:A:1", "failed");
    expect(phaseOutcome(s, "video")).toBe("running");
    set(s, "kf:A:2", "failed");
    expect(phaseOutcome(s, "video")).toBe("failed");
  });

  it("B and the shots wait for the picked frames; shots 3 and 5 wait for B; compose for every shot", () => {
    const s = state({ status: "rendering" });
    for (const id of ["score:sources", "kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"])
      set(s, id, "succeeded");
    expect(ids(s)).toEqual(["score:AC"]);
    set(s, "score:AC", "succeeded");
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

  it("the pet version's shot 3 starts from keyframe B, with no last frame", async () => {
    const s = state({ status: "rendering", picks: { A: "kf/S/a.jpg", C: "kf/S/c.jpg" } });
    s.spec.kind = "pet";
    (s.steps["kf:B"] as { outputKey: string | null }).outputKey = "kf/S/kf-B.jpg";
    const shot3 = await kieInputFor(s.steps["shot:3"]!, s, async (k) => `https://r2/${k}`);
    expect(shot3.first).toBe("https://r2/kf/S/kf-B.jpg");
    expect(shot3.last).toBeUndefined();
  });

  it("names outputs by story and step", () => {
    expect(outputKeyFor("S", "kf:A:1", "jpg")).toBe("kf/S/kf-A-1.jpg");
    expect(outputKeyFor("S", "shot:3", "mp4")).toBe("shot/S/shot-3.mp4");
  });
});

const deps = (steps: ReturnType<typeof videoSteps>) =>
  Object.fromEntries(steps.map((s) => [s.id, s.deps]));

describe("graph: steps from the story's data", () => {
  it("builds exactly the zombie steps of before, for people and pets", () => {
    expect(deps(videoSteps(ZOMBIE, "human"))).toEqual({
      "kf:A:1": [],
      "kf:A:2": [],
      "kf:C:1": [],
      "kf:C:2": [],
      "score:AC": ["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"],
      "kf:B": ["score:AC"],
      "shot:1": ["score:AC"],
      "shot:2": ["score:AC"],
      "shot:3": ["kf:B"],
      "shot:4": ["score:AC"],
      "shot:5": ["kf:B"],
      compose: ["shot:1", "shot:2", "shot:3", "shot:4", "shot:5"],
    });
    expect(deps(videoSteps(ZOMBIE, "pet"))["shot:3"]).toEqual(["kf:B"]);
  });

  it("builds the Christmas chain: describe first, four scored frames in round one", () => {
    const d = deps(videoSteps(CHRISTMAS, "human"));
    expect(d.describe).toEqual([]);
    for (const id of ["kf:wide:1", "kf:memory:2", "kf:forgetCold:1", "kf:rememberClose:2"])
      expect(d[id], id).toEqual(["describe"]);
    expect(d[SCORE]).toEqual([
      "kf:wide:1",
      "kf:wide:2",
      "kf:memory:1",
      "kf:memory:2",
      "kf:forgetCold:1",
      "kf:forgetCold:2",
      "kf:rememberClose:1",
      "kf:rememberClose:2",
    ]);
    expect(d["kf:tree"]).toEqual([SCORE]);
    expect(d["kf:forgetWarm"]).toEqual([SCORE]);
    expect(d["kf:embrace"]).toEqual(["kf:tree"]);
    expect(d["shot:1"]).toEqual([SCORE]);
    expect(d["shot:6"]).toEqual(["kf:forgetWarm"]);
    expect(d["shot:4"]).toBeUndefined();
    expect(d["shot:9"]).toBeUndefined();
    expect(d.compose).toEqual([
      "shot:1",
      "shot:2",
      "shot:3",
      "shot:5",
      "shot:6",
      "shot:7",
      "shot:8",
    ]);
  });
});

it("zombie films have no describe step", () => {
  expect(videoSteps(ZOMBIE, "human").some((s) => s.kind === "describe")).toBe(false);
});

const SCORE = "score:widememoryforgetColdrememberClose";

function stateOf(story: typeof CHRISTMAS, done: string[], failed: string[] = []): StoryState {
  const steps = Object.fromEntries(
    videoSteps(story, "human").map((s) => [
      s.id,
      {
        ...s,
        state: done.includes(s.id) ? "succeeded" : failed.includes(s.id) ? "failed" : "waiting",
        outputKey: done.includes(s.id) ? `kf/x/${s.id}.jpg` : null,
      },
    ]),
  ) as StoryState["steps"];
  return {
    spec: {
      id: "x",
      owner: "u:t",
      userId: "t",
      kind: "human",
      story: story.id,
      scene: "snow-cabin",
      names: null,
      date: null,
      survivorKey: "keep/x/survivor.jpg",
      infectedKey: "keep/x/infected.jpg",
      createdAt: 0,
    },
    status: "rendering",
    steps,
    picks: {
      wide: "kf/x/kf:wide:1.jpg",
      memory: "kf/x/kf:memory:2.jpg",
      forgetCold: "kf/x/kf:forgetCold:1.jpg",
      rememberClose: "kf/x/kf:rememberClose:1.jpg",
    },
    previewCharge: null,
    videoCharge: null,
    previewSettled: false,
    videoSettled: false,
    recomposeLeft: 1,
    output: null,
    errorCode: null,
    finishedAt: null,
    syncedSig: "",
  };
}

describe("graph: running a Christmas film", () => {
  it("scores once every candidate group has a winner, even if one candidate failed", () => {
    const s = stateOf(
      CHRISTMAS,
      [
        "kf:wide:1",
        "kf:memory:1",
        "kf:memory:2",
        "kf:forgetCold:1",
        "kf:forgetCold:2",
        "kf:rememberClose:1",
      ],
      ["kf:wide:2", "kf:rememberClose:2"],
    );
    expect(readySteps(s).map((x) => x.id)).toContain(SCORE);
  });

  it("fails when every candidate of one frame failed", () => {
    const s = stateOf(CHRISTMAS, ["kf:wide:1"], ["kf:memory:1", "kf:memory:2"]);
    expect(phaseOutcome(s, "video")).toBe("failed");
  });

  it("feeds each keyframe its refs in order: photo, picked frame, scene asset", async () => {
    const s = stateOf(CHRISTMAS, ["kf:wide:1", "kf:wide:2", SCORE]);
    const url = async (key: string) => `signed:${key}`;
    const tree = await kieInputFor(s.steps["kf:tree"] as never, s, url);
    expect(tree.images).toEqual([
      "signed:keep/x/survivor.jpg",
      "signed:keep/x/infected.jpg",
      "signed:kf/x/kf:wide:1.jpg",
      "signed:assets/stories/christmas/shared/ornament.jpg",
    ]);
    expect(tree.prompt).toContain("raising the red glass heart ornament");
  });

  it("starts a shot on its keyframe with the story's length", async () => {
    const s = stateOf(CHRISTMAS, [SCORE]);
    const shot = await kieInputFor(s.steps["shot:1"] as never, s, async (k) => `signed:${k}`);
    expect(shot).toMatchObject({
      first: "signed:kf/x/kf:forgetCold:1.jpg",
      targetSec: 3,
      images: [],
    });
  });

  it("hands the appearance lines to the keyframe prompt", async () => {
    const s = stateOf(CHRISTMAS, ["describe"]);
    s.appearance = { survivor: "full beard", infected: "blue floral headscarf covering all hair" };
    const url = async (k: string) => `signed:${k}`;
    const wide = await kieInputFor(s.steps["kf:wide:1"] as never, s, url);
    expect(wide.prompt).toContain("full beard");
    expect(wide.prompt).toContain("headscarf");
    s.appearance = undefined;
    const plain = await kieInputFor(s.steps["kf:wide:1"] as never, s, url);
    expect(plain.prompt).not.toContain(APPEARANCE_MARK);
  });
});
