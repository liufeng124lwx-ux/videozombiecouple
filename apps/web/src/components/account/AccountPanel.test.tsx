import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { errorMessage } from "@vzc/i18n";
import { describe, expect, it, vi } from "vitest";
import { onOpenSignIn } from "../../lib/bus.ts";
import { apiError, mockApi } from "../../test/mock-api.ts";
import AccountPanel from "./AccountPanel.tsx";

const ACCOUNT = {
  email: "ann@example.com",
  hasPassword: false,
  google: true,
  createdAt: 0,
  balance: { total: 25, subscription: null, permanent: 25 },
};
const BILLING = { body: { subscription: null, paidPaused: false, refundDebt: 0 } };
const QUOTA = {
  body: { remaining: 1, limit: 3, resetAt: Date.UTC(2026, 9, 10), loginRequired: false },
};
const LEDGER = { body: { entries: [], next: null } };
const STORY = (id: string, status: string) => ({
  id,
  status,
  kind: "human",
  scene: "cabin-wheat",
  createdAt: Date.UTC(2026, 9, 9),
});
const STORIES = { body: { stories: [STORY("s1", "done"), STORY("s2", "preview_ready")] } };
const member = () => ({
  "GET /v1/account": { body: ACCOUNT },
  "GET /v1/billing": BILLING,
  "GET /v1/quota": QUOTA,
  "GET /v1/stories": STORIES,
  "GET /v1/account/ledger": LEDGER,
});

describe("AccountPanel (spec 5.5, design S15)", () => {
  it("shows the balance in videos and today's free previews, with no plan", async () => {
    mockApi(member());
    render(<AccountPanel navigate={vi.fn()} />);
    expect(await screen.findByText("2 videos left")).toBeTruthy();
    expect(screen.getByText("Plus 5 credits toward your next video")).toBeTruthy();
    expect(screen.getByText(/^1 of 3 left · resets /)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get more videos" }).getAttribute("href")).toBe(
      "/pricing",
    );
    expect(screen.queryByRole("button", { name: /plan/i })).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByText(/unblur/i)).toBeNull();
  });

  it("says one video in the singular", async () => {
    mockApi({
      ...member(),
      "GET /v1/account": { body: { ...ACCOUNT, balance: { ...ACCOUNT.balance, total: 10 } } },
    });
    render(<AccountPanel navigate={vi.fn()} />);
    expect(await screen.findByText("1 video left")).toBeTruthy();
    expect(screen.queryByText(/credits toward/)).toBeNull();
  });

  it("lists the member's stories with their status, each linking to its story page", async () => {
    mockApi(member());
    render(<AccountPanel navigate={vi.fn()} />);
    const done = await screen.findByRole("link", { name: /Video ready/ });
    expect(done.getAttribute("href")).toBe("/story?id=s1");
    expect(done.textContent).toContain("Cabin → Wheat field · Couple");
    const ready = screen.getByRole("link", { name: /Preview ready/ });
    expect(ready.getAttribute("href")).toBe("/story?id=s2");
  });

  it("invites a first story when there are none", async () => {
    mockApi({ ...member(), "GET /v1/stories": { body: { stories: [] } } });
    render(<AccountPanel navigate={vi.fn()} />);
    expect(await screen.findByText(/No stories yet\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Make your first one" }).getAttribute("href")).toBe(
      "/",
    );
  });

  it("asks a signed-out visitor to sign in", async () => {
    mockApi({
      "GET /v1/account": apiError("UNAUTHORIZED", 401),
      "GET /v1/billing": apiError("UNAUTHORIZED", 401),
      "GET /v1/quota": QUOTA,
      "GET /v1/stories": apiError("LOGIN_REQUIRED", 401),
    });
    const opened = vi.fn();
    const stop = onOpenSignIn(opened);
    render(<AccountPanel navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ next: "/account" }));
    stop();
  });

  it("offers to try again when the API is down", async () => {
    mockApi({
      ...member(),
      "GET /v1/account": [apiError("PROVIDER_DOWN", 503), { body: ACCOUNT }],
    });
    render(<AccountPanel navigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(errorMessage("PROVIDER_DOWN"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 videos left")).toBeTruthy();
  });

  it("switches to the sign-in prompt when the session ends mid-visit", async () => {
    mockApi({ ...member(), "POST /v1/account/password": apiError("UNAUTHORIZED", 401) });
    render(<AccountPanel navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set a password" }));
    fireEvent.input(screen.getByLabelText("New password"), {
      target: { value: "a-long-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Sign in to see your videos")).toBeTruthy();
  });

  it("shows the paused notice while a payment dispute is open", async () => {
    mockApi({
      ...member(),
      "GET /v1/billing": { body: { subscription: null, paidPaused: true, refundDebt: 0 } },
    });
    render(<AccountPanel navigate={vi.fn()} />);
    expect(await screen.findByText(/Paid videos are paused/)).toBeTruthy();
  });

  it("signs in from the email link and goes back to where the visitor started", async () => {
    const token = "a".repeat(64);
    const { calls } = mockApi({
      ...member(),
      "POST /v1/auth/link": { body: { ok: true, created: false } },
      "GET /v1/me": {
        body: { user: { id: "u", email: "ann@example.com", hasPassword: false, google: false } },
      },
    });
    history.replaceState(
      null,
      "",
      `/account?login=${token}&next=${encodeURIComponent("/pricing?buy=pack3")}`,
    );
    const navigate = vi.fn();
    render(<AccountPanel navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/pricing?buy=pack3"));
    expect(calls.find((c) => c.path === "/v1/auth/link")?.body).toEqual({ token });
    expect(location.search).toBe("");
  });

  it("explains an expired email link", async () => {
    mockApi({
      "POST /v1/auth/link": apiError("CODE_EXPIRED", 401),
      "GET /v1/account": apiError("UNAUTHORIZED", 401),
      "GET /v1/billing": apiError("UNAUTHORIZED", 401),
      "GET /v1/quota": QUOTA,
      "GET /v1/stories": apiError("LOGIN_REQUIRED", 401),
    });
    history.replaceState(null, "", `/account?login=${"b".repeat(64)}`);
    render(<AccountPanel navigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(errorMessage("CODE_EXPIRED"));
    expect(await screen.findByText("Sign in to see your videos")).toBeTruthy();
  });

  it("never follows a next link that leaves the site", async () => {
    mockApi({
      ...member(),
      "POST /v1/auth/link": { body: { ok: true, created: false } },
      "GET /v1/me": {
        body: { user: { id: "u", email: "ann@example.com", hasPassword: false, google: false } },
      },
    });
    history.replaceState(
      null,
      "",
      `/account?login=${"c".repeat(64)}&next=${encodeURIComponent("/\\evil.com")}`,
    );
    const navigate = vi.fn();
    render(<AccountPanel navigate={navigate} />);
    expect(await screen.findByText("2 videos left")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
