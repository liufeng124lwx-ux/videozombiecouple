import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useDialog } from "../lib/dialog.ts";

type Props = { labelledBy: string; onClose: () => void; children: ComponentChildren };

/** Design §11 Modal / Sheet: a centered dialog on desktop, a bottom sheet on phones. */
export default function Modal({ labelledBy, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);
  return (
    <div class="overlay" onClick={onClose}>
      <div
        ref={box}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
