import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.ts";
import { canSkipCheck, rememberPassedCheck, withHumanCheck } from "./human-pass.ts";

describe("human check (spec 7.1)", () => {
  it("runs Turnstile first when there is no recent pass, then remembers the pass", async () => {
    const run = vi.fn(async (headers: Record<string, string>) => headers);
    expect(await withHumanCheck(run, async () => "tok")).toEqual({ "x-turnstile": "tok" });
    expect(canSkipCheck()).toBe(true);
  });

  it("tries without a token while a pass is fresh, and checks when the API asks", async () => {
    rememberPassedCheck();
    const run = vi
      .fn<(headers: Record<string, string>) => Promise<string>>()
      .mockRejectedValueOnce(new ApiError("CHALLENGE_REQUIRED"))
      .mockResolvedValueOnce("ok");
    expect(await withHumanCheck(run, async () => "tok")).toBe("ok");
    expect(run.mock.calls).toEqual([[{}], [{ "x-turnstile": "tok" }]]);
  });

  it("passes other errors straight through without a check", async () => {
    rememberPassedCheck();
    const token = vi.fn(async () => "tok");
    const run = vi.fn(async () => Promise.reject(new ApiError("RATE_LIMITED", 30)));
    await expect(withHumanCheck(run, token)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(token).not.toHaveBeenCalled();
  });

  it("reports a Turnstile that cannot load as CHALLENGE_REQUIRED", async () => {
    const blocked = async () => Promise.reject(new Error("script blocked"));
    await expect(withHumanCheck(vi.fn(), blocked)).rejects.toMatchObject({
      code: "CHALLENGE_REQUIRED",
    });
  });

  it("forgets the pass after its window", () => {
    rememberPassedCheck(0);
    expect(canSkipCheck(29 * 60 * 1000)).toBe(false);
  });
});
