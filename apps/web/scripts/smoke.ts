/**
 * Spec 11.1: after each deploy. Checks the API and the site answer, then (with SMOKE_REAL_JOB=1,
 * on staging) runs one real story through kie and the composer (~$0.92): two photos, the free
 * preview, the paid film, the public share link.
 *
 *   tsx scripts/smoke.ts https://api-staging.videozombiecouple.com https://staging.videozombiecouple.com
 *
 * The real story needs SMOKE_KEY (the staging secret of the same name, in place of Turnstile) and
 * SMOKE_SESSION (a signed-in session of a test account holding at least one video of credits).
 * The photos are AI-generated sample people, never real ones.
 */
import sharp from "sharp";

const [api, site] = process.argv.slice(2);
if (!api || !site) {
  console.error("usage: smoke.ts <api origin> <site origin>");
  process.exit(2);
}
const staging = api.includes("staging");
const sessionCookie = staging ? "upx_sess_stg" : "upx_sess";
/** The visitor id the API hands out; uploads belong to it, like a browser's cookie jar. */
let vid = "";

async function call(path: string, init: RequestInit = {}) {
  const cookies = [
    ...(process.env.SMOKE_SESSION ? [`${sessionCookie}=${process.env.SMOKE_SESSION}`] : []),
    ...(vid ? [`vid=${vid}`] : []),
  ];
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      origin: site as string,
      "content-type": "application/json",
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
      ...(process.env.SMOKE_KEY ? { "x-smoke-key": process.env.SMOKE_KEY } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  vid = response.headers.get("set-cookie")?.match(/vid=([a-f0-9]{32})/)?.[1] ?? vid;
  return response;
}

function step(name: string, ok: boolean, detail = "") {
  console.log(`smoke: ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) process.exit(1);
}

async function upload(file: string): Promise<string> {
  const jpeg = await sharp(file)
    .rotate()
    .resize(900, 1200, { fit: "cover" })
    .jpeg({ quality: 88 })
    .toBuffer();
  const ticket = await call("/v1/uploads", {
    method: "POST",
    body: JSON.stringify({ contentType: "image/jpeg", bytes: jpeg.length }),
  });
  step(`upload url ${file.split("/").pop()}`, ticket.status === 201, String(ticket.status));
  const { key, url, method, headers } = (await ticket.json()) as {
    key: string;
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  const put = await fetch(url, { method, headers, body: new Uint8Array(jpeg) });
  step("upload", put.ok, String(put.status));
  return key;
}

type View = {
  status: string;
  errorCode: string | null;
  progress: { done: number; total: number };
  video: { url: string } | null;
  shareToken?: string | null;
};

async function until(id: string, want: string[], minutes: number): Promise<View> {
  const end = Date.now() + minutes * 60_000;
  let last = "";
  while (Date.now() < end) {
    const view = (await (await call(`/v1/stories/${id}`)).json()) as View;
    const line = `${view.status} ${view.progress.done}/${view.progress.total}`;
    if (line !== last) console.log(`smoke:      ${line}`);
    last = line;
    if (want.includes(view.status) || view.status.endsWith("failed")) return view;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  step(`story reached ${want.join("/")}`, false, `timed out at ${last}`);
  throw new Error("unreachable");
}

async function realStory() {
  const survivorKey = await upload("src/assets/samples/p02-survivor.jpg");
  const infectedKey = await upload("src/assets/samples/p02-infected.jpg");
  const created = await call("/v1/stories", {
    method: "POST",
    body: JSON.stringify({
      survivorKey,
      infectedKey,
      kind: "human",
      scene: "cabin-wheat",
      names: "Mara & Eli",
      idempotencyKey: `smoke-${Date.now()}`,
    }),
  });
  const body = (await created.json()) as { storyId?: string; error?: { code: string } };
  step(
    "story created",
    created.status === 201,
    `${created.status} ${body.error?.code ?? ""}`.trim(),
  );
  const storyId = body.storyId as string;
  console.log(`smoke:      story ${storyId}`);
  const preview = await until(storyId, ["preview_ready"], 15);
  step("preview", preview.status === "preview_ready", preview.errorCode ?? preview.status);
  const rendered = await call(`/v1/stories/${storyId}/render`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `smoke-render-${storyId}` }),
  });
  const renderBody =
    rendered.status === 202 ? null : ((await rendered.json()) as { error?: { code: string } });
  step(
    "render started",
    rendered.status === 202,
    `${rendered.status} ${renderBody?.error?.code ?? ""}`.trim(),
  );
  const done = await until(storyId, ["done"], 30);
  step("film", done.status === "done" && !!done.video, done.errorCode ?? done.status);
  const film = await fetch(done.video?.url as string, { headers: { range: "bytes=0-1023" } });
  step("film downloads", film.status === 206 || film.status === 200, String(film.status));
  const shared = await fetch(`${api}/v1/share/${storyId}?t=${done.shareToken}`, {
    headers: { origin: site as string },
  });
  step("share link", shared.ok, String(shared.status));
  console.log(`smoke:      watch: ${site}/story?id=${storyId}&t=${done.shareToken}`);
}

const health = await fetch(`${api}/health`);
step("health", health.ok, String(health.status));
const home = await fetch(`${site}/`);
step("site", home.ok, String(home.status));
if (process.env.SMOKE_REAL_JOB === "1") await realStory();
