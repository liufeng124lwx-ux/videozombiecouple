/**
 * Spec 11.1: after each deploy. Checks the API answers, then (with SMOKE_REAL_JOB=1, on staging)
 * runs one real standard job through kie (~$0.016): upload, create, poll to the end.
 *
 *   tsx scripts/smoke.ts https://api-staging.videozombiecouple.com https://staging.videozombiecouple.com
 *
 * The real job needs SMOKE_KEY (the staging secret of the same name) in the environment.
 */
import sharp from "sharp";

const [api, site] = process.argv.slice(2);
if (!api || !site) {
  console.error("usage: smoke.ts <api origin> <site origin>");
  process.exit(2);
}
let cookie = "";

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      origin: site as string,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(process.env.SMOKE_KEY ? { "x-smoke-key": process.env.SMOKE_KEY } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  // Keep the guest identity the API hands out, so the job is ours on the next calls.
  const vid = response.headers.get("set-cookie")?.match(/vid=([a-f0-9]{32})/)?.[1];
  if (vid) cookie = `vid=${vid}`;
  return response;
}

function step(name: string, ok: boolean, detail = "") {
  console.log(`smoke: ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) process.exit(1);
}

async function realJob() {
  // A 4:3 photo, so no padding is needed: the cropBox is the whole picture.
  const jpeg = await sharp("src/assets/samples/portrait-before.jpg")
    .resize(1024, 768, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
  const upload = await call("/v1/uploads", {
    method: "POST",
    body: JSON.stringify({ contentType: "image/jpeg", bytes: jpeg.length }),
  });
  step("upload url", upload.status === 201, String(upload.status));
  const { key, url } = (await upload.json()) as { key: string; url: string };
  const put = await fetch(url, {
    method: "PUT",
    body: new Uint8Array(jpeg),
    headers: { "content-type": "image/jpeg" },
  });
  step("upload", put.ok, String(put.status));
  const created = await call("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      uploadKey: key,
      capability: "unblur.std",
      mode: "auto",
      modeSource: "auto",
      cropBox: { x: 0, y: 0, w: 1, h: 1 },
      diagnosis: {
        sharpness: 30,
        blur: "motion",
        angleDeg: 0,
        faces: [],
        textDensity: 0,
        oldPhoto: false,
      },
      idempotencyKey: `smoke-${Date.now()}`,
    }),
  });
  step("job created", created.status === 201, String(created.status));
  const { jobId } = (await created.json()) as { jobId: string };
  const deadline = Date.now() + 5 * 60_000;
  let state = "";
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const job = (await (await call(`/v1/jobs/${jobId}`)).json()) as { state: string };
    state = job.state;
    if (state === "succeeded" || state === "failed") break;
  }
  step("real job finishes", state === "succeeded", `${jobId}: ${state}`);
}

const health = await fetch(`${api}/health`);
step("health", health.ok, String(health.status));
const tools = await call("/v1/tools");
const view = tools.ok ? ((await tools.json()) as Record<string, { aspects: string[] }>) : {};
step(
  "tools",
  ["unblur.std", "unblur.pro", "unblur.4k"].every((id) => (view[id]?.aspects.length ?? 0) > 0),
);
if (process.env.SMOKE_REAL_JOB === "1") await realJob();
console.log("smoke: OK");
