/** Page-wide events between islands: open the sign-in dialog, and "someone just signed in". */
export type SignInRequest = { heading?: string | undefined; next?: string | undefined };

const OPEN = "upx:open-signin";
const DONE = "upx:signed-in";

export function openSignIn(request: SignInRequest = {}): void {
  window.dispatchEvent(new CustomEvent<SignInRequest>(OPEN, { detail: request }));
}

export function onOpenSignIn(handler: (request: SignInRequest) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<SignInRequest>).detail);
  window.addEventListener(OPEN, listener);
  return () => window.removeEventListener(OPEN, listener);
}

export function notifySignedIn(created: boolean): void {
  window.dispatchEvent(new CustomEvent<{ created: boolean }>(DONE, { detail: { created } }));
}

export function onSignedIn(handler: (created: boolean) => void): () => void {
  const listener = (event: Event) =>
    handler((event as CustomEvent<{ created: boolean }>).detail.created);
  window.addEventListener(DONE, listener);
  return () => window.removeEventListener(DONE, listener);
}

const CHANGED = "upx:account-changed";

/** The balance or plan changed (a payment arrived): the header refreshes its credits. */
export function notifyAccountChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

export function onAccountChanged(handler: () => void): () => void {
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}
