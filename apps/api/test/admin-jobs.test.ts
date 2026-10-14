import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

describe("admin jobs (spec 8.1)", () => {
  it("finds a job by its id or a kie task id, with its attempts and signed links", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const { spec } = await h.job();
    h.db.prepare("UPDATE jobs SET status='succeeded', attempts=? WHERE id=?").run(
      JSON.stringify([
        {
          id: "a1",
          model: "seedream",
          role: "primary",
          state: "succeeded",
          taskId: "kie-task-77",
          costUsd: 0.0162,
          failMsg: "<b>bold</b>",
        },
      ]),
      spec.id,
    );
    await h.r2.BUCKET.put(`out/${spec.id}/a1.png`, "x");
    const found = await (await kit.get("/admin/jobs?q=kie-task-77")).text();
    expect(found).toContain(spec.id);
    expect(await (await kit.get(`/admin/jobs?q=${spec.id}`)).text()).toContain(
      `/admin/jobs/${spec.id}`,
    );
    const detail = await (await kit.get(`/admin/jobs/${spec.id}`)).text();
    expect(detail).toContain("seedream");
    expect(detail).toContain("kie-task-77");
    expect(detail).toContain("X-Amz-Signature");
    expect(detail).toContain(`out/${spec.id}/a1.png`);
    expect(detail).not.toContain("<b>bold</b>");
    expect((await kit.get("/admin/jobs/nope")).status).toBe(404);
  });

  it("shows no links once a job has expired", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const { spec } = await h.job();
    h.db.prepare("UPDATE jobs SET status='expired' WHERE id=?").run(spec.id);
    expect(await (await kit.get(`/admin/jobs/${spec.id}`)).text()).not.toContain("X-Amz-Signature");
  });
});
