import { describe, expect, it } from "vitest";
import {
  CreateStorySchema,
  ERROR_CHARGE,
  RecomposeSchema,
  RenderSchema,
  UploadKeySchema,
} from "../src/index.ts";

const key = "in/01HZX5V3Q4W7E8R9T0Y1Z2A3B4.jpg";
const base = {
  survivorKey: key,
  infectedKey: key,
  kind: "human",
  scene: "cabin-wheat",
  idempotencyKey: "abcdefgh",
};

describe("story contracts", () => {
  it("accepts a valid story request with optional names and date", () => {
    expect(CreateStorySchema.safeParse(base).success).toBe(true);
    expect(CreateStorySchema.parse({ ...base, names: " Tom & Amy ", date: "2019" })).toMatchObject({
      names: "Tom & Amy",
      date: "2019",
    });
  });

  it("rejects keys outside the upload prefix and unknown scenes or kinds", () => {
    expect(UploadKeySchema.safeParse("keep/x.jpg").success).toBe(false);
    expect(UploadKeySchema.safeParse("in/../x.jpg").success).toBe(false);
    expect(CreateStorySchema.safeParse({ ...base, scene: "mars" }).success).toBe(false);
    expect(CreateStorySchema.safeParse({ ...base, kind: "robot" }).success).toBe(false);
  });

  it("caps caption length and requires an idempotency key to render", () => {
    expect(RecomposeSchema.safeParse({ names: "x".repeat(41), date: "2019" }).success).toBe(false);
    expect(RenderSchema.safeParse({}).success).toBe(false);
  });

  it("says what each new error means for the user's credits", () => {
    expect(ERROR_CHARGE.PREVIEW_QUOTA_EXHAUSTED).toBe("none");
    expect(ERROR_CHARGE.FACE_NOT_FOUND).toBe("refunded");
    expect(ERROR_CHARGE.COMPOSE_FAILED).toBe("refunded");
  });
});
