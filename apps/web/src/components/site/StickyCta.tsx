import { useEffect, useState } from "preact/hooks";

/** Scrolled this far, the hero's own button is off screen. */
const PAST_HERO_PX = 600;

/**
 * Phones only (CSS): the page's main action pinned to the bottom of the screen once the hero is
 * scrolled past, and out of the way while the tool it points to is on screen.
 */
export default function StickyCta({
  href,
  label,
  target,
}: {
  href: string;
  label: string;
  /** Id of the section the button leads to; the button hides while it is visible. */
  target: string;
}) {
  const [past, setPast] = useState(false);
  const [overTool, setOverTool] = useState(false);

  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > PAST_HERO_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const el = document.getElementById(target);
    const observer =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) setOverTool(entry.isIntersecting);
          })
        : null;
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [target]);

  const on = past && !overTool;
  return (
    <div class="sticky-cta" data-on={String(on)} aria-hidden={!on}>
      <a class="btn btn-primary btn-lg btn-block" href={href} tabIndex={on ? 0 : -1}>
        {label}
      </a>
    </div>
  );
}
