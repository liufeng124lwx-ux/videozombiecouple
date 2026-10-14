import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

describe("admin stories (spec 8.1)", () => {
  it("finds a story by its id or a kie task id, with its attempts and signed links", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const { spec } = await h.story();
    h.db.prepare("UPDATE stories SET status='done', steps=? WHERE id=?").run(
      JSON.stringify([
        {
          id: "kf:A:1",
          phase: "preview",
          capability: "keyframe",
          state: "succeeded",
          error: null,
          attempts: [
            {
              model: "nano-banana-pro",
              state: "succeeded",
              taskId: "kie-task-77",
              costUsd: 0.09,
              failKind: null,
              failMsg: "<b>bold</b>",
            },
          ],
        },
      ]),
      spec.id,
    );
    await h.r2.BUCKET.put(`out/${spec.id}/video.mp4`, "x");
    const found = await (await kit.get("/admin/jobs?q=kie-task-77")).text();
    expect(found).toContain(spec.id);
    expect(await (await kit.get(`/admin/jobs?q=${spec.id}`)).text()).toContain(
      `/admin/jobs/${spec.id}`,
    );
    const detail = await (await kit.get(`/admin/jobs/${spec.id}`)).text();
    expect(detail).toContain("nano-banana-pro");
    expect(detail).toContain("kf:A:1");
    expect(detail).toContain("kie-task-77");
    expect(detail).toContain("X-Amz-Signature");
    expect(detail).toContain(`out/${spec.id}/video.mp4`);
    expect(detail).toContain(`keep/${spec.id}/survivor.jpg`);
    expect(detail).not.toContain("<b>bold</b>");
    expect((await kit.get("/admin/jobs/nope")).status).toBe(404);
  });

  it("shows no links once a story has expired", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const { spec } = await h.story();
    h.db.prepare("UPDATE stories SET status='expired' WHERE id=?").run(spec.id);
    expect(await (await kit.get(`/admin/jobs/${spec.id}`)).text()).not.toContain("X-Amz-Signature");
  });
});
