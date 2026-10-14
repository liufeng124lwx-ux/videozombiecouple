import type { Bindings } from "../types.ts";

const escape = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

/** Plain transactional mail: a short intro, an optional big code and an optional link. */
export async function sendMail(
  env: Bindings,
  message: {
    to: string;
    subject: string;
    intro: string;
    code?: string;
    link?: { href: string; label: string };
  },
): Promise<void> {
  if (!env.EMAIL) return;
  const lines = [message.intro];
  if (message.code) lines.push("", `Your code: ${message.code}`, "It expires in 10 minutes.");
  if (message.link) lines.push("", `${message.link.label}: ${message.link.href}`);
  lines.push("", "If you didn't ask for this, you can ignore this email.");
  const html = [
    `<p>${escape(message.intro)}</p>`,
    message.code
      ? `<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${message.code}</p><p>It expires in 10 minutes.</p>`
      : "",
    message.link
      ? `<p><a href="${escape(message.link.href)}">${escape(message.link.label)}</a></p>`
      : "",
    "<p>If you didn't ask for this, you can ignore this email.</p>",
  ].join("");
  await env.EMAIL.send({
    to: message.to,
    from: env.EMAIL_FROM ?? "VideoZombieCouple <no-reply@videozombiecouple.com>",
    subject: message.subject,
    text: lines.join("\n"),
    html,
  });
}
