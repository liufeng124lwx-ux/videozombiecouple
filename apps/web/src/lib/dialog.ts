import { type RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal basics (design §11): focus moves into the dialog (its first field), Tab stays inside,
 * Escape closes, and focus returns to whatever opened it.
 */
export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    const items = () => [...(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (box && !box.contains(document.activeElement))
      (box.querySelector<HTMLElement>("input:not([disabled])") ?? items()[0] ?? box).focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);
}
