import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "buttons.css"), "utf8");
const rule = (sel: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";

describe("buttons (design lock: ember is the primary action only)", () => {
  it("fills only the primary button with ember, with dark text on it", () => {
    expect(rule(".btn-primary")).toMatch(/background:\s*var\(--ember\)/);
    expect(rule(".btn-primary")).toMatch(/color:\s*var\(--on-ember\)/);
    for (const sel of [".btn", ".btn-ghost", ".btn-danger"])
      expect(rule(sel)).not.toMatch(/var\(--ember\)/);
  });
  it("keeps every button sharp and shadowless", () => {
    expect(rule(".btn")).toMatch(/border-radius:\s*var\(--r-btn\)/);
    expect(css).not.toMatch(/box-shadow:\s*0\s+\d+px/);
    expect(css).not.toMatch(/gradient/);
  });
  it("makes disabled buttons look disabled", () => {
    expect(rule('.btn:disabled,\n.btn[aria-disabled="true"]')).toMatch(/cursor:\s*not-allowed/);
  });
});
