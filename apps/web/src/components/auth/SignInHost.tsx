import { useEffect, useState } from "preact/hooks";
import { track } from "../../lib/analytics.ts";
import { notifySignedIn, onOpenSignIn, type SignInRequest } from "../../lib/bus.ts";
import { refreshMe } from "../../lib/me.ts";
import SignInDialog from "./SignInDialog.tsx";

/** Mounted once per page; any island opens the dialog with openSignIn(). */
export default function SignInHost() {
  const [request, setRequest] = useState<SignInRequest | null>(null);
  useEffect(() => onOpenSignIn(setRequest), []);
  if (!request) return null;
  return (
    <SignInDialog
      request={request}
      onClose={() => setRequest(null)}
      onSignedIn={(created) => {
        setRequest(null);
        track(created ? "signup" : "login");
        // Every island reads the signed-in account from loadMe() after this.
        void refreshMe().then(() => notifySignedIn(created));
      }}
    />
  );
}
