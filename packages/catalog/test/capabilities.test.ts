import { describe, expect, it } from "vitest";
import { CAPABILITIES, isTaskCapability, TASK_CAPABILITY_IDS, taskPool } from "../src/index.ts";

describe("capabilities", () => {
  it("describe is a synchronous text call, not a kie task", () => {
    expect(CAPABILITIES.describe).toEqual({ id: "describe", pool: "kie-text", p50Ms: 5_000 });
    expect(TASK_CAPABILITY_IDS).toEqual(["keyframe", "shot"]);
    expect(isTaskCapability("describe")).toBe(false);
    expect(isTaskCapability("keyframe")).toBe(true);
  });

  it("only task capabilities have a dispatcher pool", () => {
    expect(taskPool("keyframe")).toBe("kie-image");
    expect(taskPool("shot")).toBe("kie-video");
    expect(() => taskPool("describe")).toThrow(/not a task/);
  });
});
