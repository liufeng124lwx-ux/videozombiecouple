import { t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";

export const CODE_LENGTH = 6;

type Props = { onComplete: (code: string) => void; disabled?: boolean };

/** Design §11: one box per digit; typing moves on, Backspace moves back, a pasted code fills all. */
export default function CodeInput({ onComplete, disabled = false }: Props) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(CODE_LENGTH).fill(""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    boxes.current[0]?.focus();
  }, []);

  function fill(from: number, text: string) {
    const incoming = text.replace(/\D/g, "").split("");
    const next = [...digits];
    if (incoming.length === 0) next[from] = "";
    incoming.slice(0, CODE_LENGTH - from).forEach((digit, i) => {
      next[from + i] = digit;
    });
    setDigits(next);
    if (next.every((digit) => digit !== "")) onComplete(next.join(""));
    else if (incoming.length > 0)
      boxes.current[Math.min(from + incoming.length, CODE_LENGTH - 1)]?.focus();
  }

  return (
    <div class="code" role="group" aria-label={t("auth.codeLabel")}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          class="code-box"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("auth.digit", { n: i + 1 })}
          value={digit}
          disabled={disabled}
          onInput={(e) => fill(i, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && digit === "" && i > 0) boxes.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            fill(i, e.clipboardData?.getData("text") ?? "");
          }}
        />
      ))}
    </div>
  );
}
