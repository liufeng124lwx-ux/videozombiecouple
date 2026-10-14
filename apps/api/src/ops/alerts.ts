import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

export type Alert = { key: string; title: string; detail: string };
export type Send = (env: Bindings, text: string) => Promise<void>;
type State = { at: number; open: boolean };

const stateKey = (key: string) => `alert:${key}`;

async function read(env: Bindings, key: string): Promise<State | null> {
  try {
    return JSON.parse((await env.KV.get(stateKey(key))) ?? "null") as State | null;
  } catch {
    return null;
  }
}

const escape = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

/** Spec 8.3: Telegram first, an email copy, and a log line; a failing channel never throws. */
export const deliver: Send = async (env, text) => {
  console.log(JSON.stringify({ level: "alert", text }));
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      });
    } catch {}
  }
  if (env.EMAIL && env.ALERT_EMAIL) {
    try {
      await env.EMAIL.send({
        to: env.ALERT_EMAIL,
        from: env.EMAIL_FROM ?? "VideoZombieCouple <no-reply@videozombiecouple.com>",
        subject: text.split("\n")[0] ?? "VideoZombieCouple alert",
        text,
        html: `<pre>${escape(text)}</pre>`,
      });
    } catch {}
  }
};

/** Opens (or repeats) an alert; at most once per quiet window while it stays open. */
export async function raise(
  env: Bindings,
  alert: Alert,
  now: number,
  send: Send = deliver,
): Promise<boolean> {
  const state = await read(env, alert.key);
  if (state?.open && now - state.at < OPS.alertQuietMs) return false;
  await send(env, `${alert.title}\n${alert.detail}`);
  await env.KV.put(stateKey(alert.key), JSON.stringify({ at: now, open: true }));
  return true;
}

/** Closes an open alert with one "Resolved" message; nothing when it wasn't open. */
export async function resolve(
  env: Bindings,
  key: string,
  title: string,
  now: number,
  send: Send = deliver,
): Promise<boolean> {
  const state = await read(env, key);
  if (!state?.open) return false;
  await send(env, `Resolved: ${title}`);
  await env.KV.put(stateKey(key), JSON.stringify({ at: now, open: false }));
  return true;
}
