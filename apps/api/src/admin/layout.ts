import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
body{font:14px/1.5 system-ui,sans-serif;margin:0;color:#111;background:#fff}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:10px 20px;background:#111}
header a{color:#fff;text-decoration:none;font-weight:600}
header .who{margin-left:auto;color:#bbb}
main{padding:20px;max-width:1200px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f6f6f4}
form.inline{display:inline}
input,select,button{font:inherit;padding:4px 8px}
.note{color:#555}
code{font-size:12px;word-break:break-all}
`;

/** Spec 8.1 / design §10: plain tables and forms. Everything interpolated is escaped by `html`. */
export function page(title: string, actor: string, body: Body) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="robots" content="noindex,nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · VideoZombieCouple admin</title>
        <style>
          ${raw(CSS)}
        </style>
      </head>
      <body>
        <header>
          <a href="/admin">Switches</a><a href="/admin/users">Users</a><a href="/admin/jobs">Jobs</a>
          <a href="/admin/routes">Routes</a><a href="/admin/bans">Bans</a>
          <span class="who">${actor}</span>
        </header>
        <main>
          <h1>${title}</h1>
          ${body}
        </main>
      </body>
    </html>`;
}
