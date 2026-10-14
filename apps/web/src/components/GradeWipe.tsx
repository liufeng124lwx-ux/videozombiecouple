import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type Frame = { src: string; alt: string; srcset?: string; sizes?: string };

export type GradeWipeProps = {
  /** The standoff (left, cold). */
  cold: Frame;
  /** The memory (right, warm). */
  warm: Frame;
  /** auto: drifts on its own · drag: the viewer moves the cut · progress: follows `value` ·
   * still: a fixed split at `value` (decorative, e.g. scene tiles). */
  mode: "auto" | "drag" | "progress" | "still";
  value?: number;
  label?: string;
  priority?: boolean;
  class?: string;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The signature move (design lock §5): the video's match cut as an interface. The warm memory is
 * revealed right of a 1px ember line; everything moves with transforms only.
 */
export default function GradeWipe(props: GradeWipeProps) {
  const { cold, warm, mode } = props;
  const [cut, setCut] = useState(50);
  const [drift, setDrift] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const position = mode === "progress" || mode === "still" ? clamp(props.value ?? 50) : cut;

  useEffect(() => {
    setDrift(mode === "auto" && !reducedMotion());
  }, [mode]);

  const fromPointer = (clientX: number) => {
    const box = root.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setCut(clamp(((clientX - box.left) / box.width) * 100));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      setCut((c) => clamp(c + step));
    } else if (e.key === "Home") setCut(0);
    else if (e.key === "End") setCut(100);
  };

  const style = { "--cut": `${position}%` } as JSX.CSSProperties;
  const drag =
    mode === "drag"
      ? {
          onPointerDown: (e: PointerEvent) => {
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            fromPointer(e.clientX);
          },
          onPointerMove: (e: PointerEvent) => dragging.current && fromPointer(e.clientX),
          onPointerUp: () => {
            dragging.current = false;
          },
        }
      : {};

  return (
    <div
      ref={root}
      class={`wipe${drift ? " drift" : ""}${mode === "drag" ? " draggable" : ""}${props.class ? ` ${props.class}` : ""}`}
      style={style}
      {...drag}
    >
      <img
        class="wipe-cold"
        src={cold.src}
        srcset={cold.srcset}
        sizes={cold.sizes}
        alt={cold.alt}
        width={720}
        height={1280}
        loading={props.priority ? "eager" : "lazy"}
        fetchpriority={props.priority ? "high" : undefined}
        decoding="async"
      />
      <div class="wipe-warm">
        <img
          src={warm.src}
          srcset={warm.srcset}
          sizes={warm.sizes}
          alt={warm.alt}
          width={720}
          height={1280}
          loading={props.priority ? "eager" : "lazy"}
          decoding="async"
        />
        <span class="wipe-line" aria-hidden="true" />
      </div>
      {mode === "drag" && (
        <div
          class="wipe-handle"
          role="slider"
          tabIndex={0}
          aria-label={props.label ?? "Move the cut between the standoff and the memory"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
          onKeyDown={onKey}
        />
      )}
      {mode === "progress" && (
        <div
          class="visually-hidden"
          role="progressbar"
          aria-label={props.label ?? "Progress"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
        />
      )}
    </div>
  );
}
