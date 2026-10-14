// Minimal kie.ai client for the eval harness (Node >= 24, native TS, no deps).
// kie answers HTTP 200 even on errors: always check the body `code`.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname } from "node:path";

const API = "https://api.kie.ai/api/v1";
const UPLOAD = "https://kieai.redpandaai.co/api";
export const USD_PER_CREDIT = 0.005;
// 401 bad key, 402 balance, 433 sub-key limit: continuing the run cannot succeed.
const FATAL_CODES = new Set([401, 402, 433]);

export class KieError extends Error {
  code: number | null;
  fatal: boolean;
  constructor(message: string, code: number | null) {
    super(message);
    this.code = code;
    this.fatal = code !== null && FATAL_CODES.has(code);
  }
}

export type TaskResult = {
  state: "success" | "fail";
  urls: string[];
  creditsConsumed: number | null;
  costTimeSec: number | null;
  failMsg?: string;
};

export function parseRecord(d: any): TaskResult | null {
  if (d?.state !== "success" && d?.state !== "fail") return null;
  let urls: string[] = Array.isArray(d.response?.resultUrls) ? d.response.resultUrls : [];
  if (!urls.length) {
    try {
      urls = JSON.parse(d.resultJson ?? "{}").resultUrls ?? [];
    } catch {
      urls = [];
    }
  }
  return {
    state: d.state,
    urls,
    creditsConsumed: typeof d.creditsConsumed === "number" ? d.creditsConsumed : null,
    costTimeSec: typeof d.costTime === "number" ? d.costTime : null,
    failMsg: d.failMsg || d.failCode || undefined,
  };
}

export class KieClient {
  key: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;

  constructor(key: string, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.key = key;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  private headers() {
    return { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" };
  }

  private async body(res: Response, what: string): Promise<any> {
    const j: any = await res.json().catch(() => ({}));
    if (j?.code !== 200) {
      const code = typeof j?.code === "number" ? j.code : null;
      throw new KieError(`${what} failed: code=${code ?? res.status} ${j?.msg ?? ""}`.trim(), code);
    }
    return j;
  }

  /** Upload bytes to kie's temp storage (kept ~24h); returns a URL usable as model input. */
  async upload(bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
    const base64Data = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    const res = await this.fetchImpl(`${UPLOAD}/file-base64-upload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ base64Data, uploadPath: "vzc-eval", fileName }),
    });
    const j = await this.body(res, "upload");
    const url = j?.data?.downloadUrl;
    if (!url) throw new KieError("upload failed: no downloadUrl", null);
    return url;
  }

  async createTask(model: string, input: Record<string, unknown>): Promise<string> {
    const res = await this.fetchImpl(`${API}/jobs/createTask`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input }),
    });
    const j = await this.body(res, `createTask ${model}`);
    if (!j?.data?.taskId) throw new KieError(`createTask ${model} failed: no taskId`, null);
    return j.data.taskId;
  }

  async wait(taskId: string, timeoutMs: number): Promise<TaskResult> {
    const started = Date.now();
    let delay = 3000;
    while (Date.now() - started < timeoutMs) {
      await this.sleep(delay);
      delay = Math.min(delay * 1.4, 10_000);
      const res = await this.fetchImpl(`${API}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: this.headers() });
      const j: any = await res.json().catch(() => ({}));
      if (j?.code !== 200) {
        const code = typeof j?.code === "number" ? j.code : null;
        if (code !== null && FATAL_CODES.has(code)) throw new KieError(`recordInfo failed: code=${code}`, code);
        continue; // transient: keep polling
      }
      const r = parseRecord(j.data);
      if (r) return r;
    }
    throw new Error(`task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s`);
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  }
}

const MIME: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Upload each local file at most once per 20h (kie keeps uploads ~24h). */
export class UploadCache {
  kie: { upload: KieClient["upload"] };
  cacheFile: string;
  now: () => number;
  private cache: Record<string, { url: string; at: number }> | null = null;

  constructor(kie: { upload: KieClient["upload"] }, cacheFile: string, now: () => number = Date.now) {
    this.kie = kie;
    this.cacheFile = cacheFile;
    this.now = now;
  }

  async urlFor(path: string): Promise<string> {
    if (!this.cache) this.cache = existsSync(this.cacheFile) ? JSON.parse(await readFile(this.cacheFile, "utf8")) : {};
    const cache = this.cache!;
    const hit = cache[path];
    if (hit && this.now() - hit.at < 20 * 3600_000) return hit.url;
    const ext = extname(path).toLowerCase();
    const name = createHash("sha1").update(path).digest("hex").slice(0, 12) + ext;
    const url = await this.kie.upload(new Uint8Array(await readFile(path)), MIME[ext] ?? "image/jpeg", name);
    cache[path] = { url, at: this.now() };
    await writeFile(this.cacheFile, JSON.stringify(cache, null, 1));
    return url;
  }
}
