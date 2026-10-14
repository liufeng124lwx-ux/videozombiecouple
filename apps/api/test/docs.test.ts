import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (path: string) =>
  readFileSync(new URL(`../../../docs/${path}`, import.meta.url), "utf8");

describe("runbooks and the launch checklist (spec 8.6, 11.3)", () => {
  it.each([
    "runbooks/kie-outage.md",
    "runbooks/model-removed-or-repriced.md",
    "runbooks/payment-webhooks-failing.md",
    "runbooks/cost-spike-or-abuse.md",
    "runbooks/d1-restore.md",
  ])("%s says what you see, how to judge, how to stop the damage and how to recover", (file) => {
    const text = doc(file);
    for (const heading of ["## 现象", "## 判断", "## 止损", "## 恢复"])
      expect(text).toContain(heading);
  });

  it("lists every launch gate from spec 11.3 and the external steps", () => {
    const text = doc("launch-checklist.md");
    for (const gate of [
      "真实照片评测",
      "第二供应商",
      "Waffo",
      "法律页",
      "密钥",
      "测试卡",
      "GSC",
      "Access",
      "Sentry",
      "samples/health.jpg",
      "setup-cloudflare.sh",
      "launch-secrets.sh",
      "STAGING_SMOKE_KEY",
      "成本护栏",
    ])
      expect(text).toContain(gate);
    expect(text).not.toMatch(/护照|passport|银行卡号|EIN[:：]?\s*\d/i);
  });

  it("gates the deploy on the cost-guardrails runbook checklist (spec 9)", () => {
    const runbook = doc("runbooks/cost-guardrails.md");
    for (const heading of [
      "## 1. kie 子密钥每日额度",
      "## 2. Cloudflare 账单提醒",
      "## 3. Cloudflare WAF 限速规则",
      "## 4. staging 演练",
      "## 5. 核对清单",
    ])
      expect(runbook).toContain(heading);
    expect(doc("launch-checklist.md")).toContain(
      "成本护栏 runbook（docs/runbooks/cost-guardrails.md）第 5 节全部打勾，才能恢复部署",
    );
  });

  it("the cost-spike runbook names the real free budget constant", () => {
    const text = doc("runbooks/cost-spike-or-abuse.md");
    expect(text).not.toContain("OPS.freeTierDailyUsd");
    expect(text).toContain("BUDGETS.free.dailyUsd");
  });
});
