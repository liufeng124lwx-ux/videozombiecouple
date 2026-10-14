import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { QUOTA } from "@vzc/catalog";
import { errorMessage } from "@vzc/i18n";
import { describe, expect, it, vi } from "vitest";
import { rememberPassedCheck } from "../../lib/human-pass.ts";
import { apiError, mockApi } from "../../test/mock-api.ts";
import SignInDialog from "./SignInDialog.tsx";

const OK = { body: { ok: true, created: true } };
const SENT = { status: 202, body: { sent: true } };

function open(overrides: { getToken?: () => Promise<string> } = {}) {
  const onSignedIn = vi.fn();
  const onClose = vi.fn();
  render(
    <SignInDialog
      request={{ next: "/pricing" }}
      onClose={onClose}
      onSignedIn={onSignedIn}
      getToken={overrides.getToken ?? (async () => "tok")}
    />,
  );
  return { onSignedIn, onClose };
}

async function askForCode(email = "ann@example.com") {
  fireEvent.input(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
}

describe("SignInDialog (design S9, flows ②③)", () => {
  it("says sign-in is for the free preview, and promises no sign-up bonus", () => {
    mockApi({});
    open();
    const purpose = screen.getByText(/^Sign in to get your free preview/);
    expect(purpose.textContent).toContain(`${QUOTA.previewUserDaily} a day`);
    expect(screen.queryByText(/bonus|credits/i)).toBeNull();
  });

  it("emails a code after the human check, then signs in with it", async () => {
    const { calls } = mockApi({ "POST /v1/auth/email": SENT, "POST /v1/auth/code": OK });
    const { onSignedIn } = open();
    await askForCode();
    expect(await screen.findByText("Check your email")).toBeTruthy();
    expect(calls[0]).toMatchObject({
      path: "/v1/auth/email",
      body: { email: "ann@example.com", next: "/pricing" },
      headers: { "x-turnstile": "tok" },
    });
    fireEvent.input(screen.getByLabelText("Digit 1"), { target: { value: "481516" } });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(true));
    expect(calls[1]).toMatchObject({
      path: "/v1/auth/code",
      body: { email: "ann@example.com", code: "481516" },
    });
  });

  it("skips Turnstile while a pass is fresh, and runs it when the API asks", async () => {
    rememberPassedCheck();
    const getToken = vi.fn(async () => "tok");
    const { calls } = mockApi({
      "POST /v1/auth/email": [apiError("CHALLENGE_REQUIRED", 403), SENT],
    });
    open({ getToken });
    await askForCode();
    await screen.findByText("Check your email");
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.headers["x-turnstile"])).toEqual([undefined, "tok"]);
  });

  it("explains when the human check is blocked", async () => {
    mockApi({});
    open({ getToken: async () => Promise.reject(new Error("blocked")) });
    await askForCode();
    expect((await screen.findByRole("alert")).textContent).toBe(errorMessage("CHALLENGE_REQUIRED"));
    expect(
      (screen.getByRole("button", { name: "Email me a code" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("clears the boxes after a wrong code", async () => {
    mockApi({ "POST /v1/auth/email": SENT, "POST /v1/auth/code": apiError("CODE_INVALID", 401) });
    open();
    await askForCode();
    await screen.findByText("Check your email");
    fireEvent.input(screen.getByLabelText("Digit 1"), { target: { value: "111111" } });
    expect((await screen.findByRole("alert")).textContent).toBe(errorMessage("CODE_INVALID"));
    expect((screen.getByLabelText("Digit 6") as HTMLInputElement).value).toBe("");
  });

  it("lets the code be resent after the countdown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockApi({ "POST /v1/auth/email": SENT });
    open();
    await askForCode();
    expect(await screen.findByText("Resend in 1:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("signs in with a password", async () => {
    mockApi({
      "POST /v1/auth/password": [
        apiError("INVALID_CREDENTIALS", 401),
        { body: { ok: true, created: false } },
      ],
    });
    const { onSignedIn } = open();
    fireEvent.click(screen.getByRole("button", { name: "Use a password instead" }));
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ann@example.com" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      errorMessage("INVALID_CREDENTIALS"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(false));
  });

  it("sends Google sign-in back to the same page, and closes on Escape", () => {
    mockApi({});
    const { onClose } = open();
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe(
      "http://localhost:8787/auth/google/start?next=%2Fpricing",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus into the dialog, keeps Tab inside and gives focus back on close", () => {
    mockApi({});
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <SignInDialog
        request={{}}
        onClose={vi.fn()}
        onSignedIn={vi.fn()}
        getToken={async () => "tok"}
      />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>("a[href], button, input");
    focusable[focusable.length - 1]?.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
