import { describe, expect, it } from "vitest";
import { CreateJobSchema, EVENT_NAMES, RetrySchema } from "../src/index.ts";

const valid = {
  uploadKey: "in/01JA8Z9X3K7M2N4P6Q8R0S1T2V.jpg",
  capability: "unblur.std",
  mode: "portrait",
  modeSource: "auto",
  cropBox: { x: 0.125, y: 0, w: 0.75, h: 1 },
  diagnosis: {
    sharpness: 31,
    blur: "motion",
    angleDeg: 160,
    faces: [{ x: 0.37, y: 0.23, w: 0.29, h: 0.39 }],
    textDensity: 0.02,
    oldPhoto: false,
  },
  idempotencyKey: "a1b2c3d4e5f6g7h8",
};

describe("CreateJobSchema", () => {
  it("accepts a well-formed request", () => {
    expect(CreateJobSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects upload keys outside in/ or with another extension", () => {
    for (const uploadKey of ["../etc/passwd", "in/abc.png", "out/01JA8Z9X3K7M2N4P6Q8R0S1T2V.jpg"])
      expect(CreateJobSchema.safeParse({ ...valid, uploadKey }).success).toBe(false);
  });

  it("rejects a crop box that sticks out of the canvas", () => {
    const cropBox = { x: 0.5, y: 0, w: 0.75, h: 1 };
    expect(CreateJobSchema.safeParse({ ...valid, cropBox }).success).toBe(false);
  });

  it("rejects unknown capabilities and modes", () => {
    expect(CreateJobSchema.safeParse({ ...valid, capability: "unblur.8k" }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...valid, mode: "anime" }).success).toBe(false);
  });
});

describe("RetrySchema", () => {
  const failing = {
    composition: 0.71,
    colorDeltaE: 4,
    faces: { expected: 1, matched: 0 },
    passed: false,
  };

  it("accepts a guard retry with failing metrics", () => {
    expect(
      RetrySchema.safeParse({ attemptId: "a1", reason: "guard", guard: failing }).success,
    ).toBe(true);
  });

  it("rejects a guard retry without metrics or with passing metrics", () => {
    expect(RetrySchema.safeParse({ attemptId: "a1", reason: "guard" }).success).toBe(false);
    expect(
      RetrySchema.safeParse({
        attemptId: "a1",
        reason: "guard",
        guard: { ...failing, passed: true },
      }).success,
    ).toBe(false);
  });

  it("accepts a thumbs-down retry with an optional reason", () => {
    expect(
      RetrySchema.safeParse({ attemptId: "a1", reason: "thumbs_down", feedback: "face" }).success,
    ).toBe(true);
  });
});

describe("events", () => {
  it("are unique snake_case names", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z]+(_[a-z0-9]+)*$/);
  });
});
