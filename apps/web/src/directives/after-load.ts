import type { ClientDirective } from "astro";

/**
 * Hydrates a short while after the page has finished loading. `client:visible` and `client:idle`
 * start fetching the island's scripts before the first paint on a short page, and Lighthouse then
 * counts them toward FCP and LCP (the local tool pages' LCP went from about 2.1 s to 2.6 s; see
 * docs/lessons.md section 2). The delay only has to push the fetch past the first paint.
 */
const afterLoad: ClientDirective = (load) => {
  const start = () => setTimeout(() => void load().then((hydrate) => hydrate()), 400);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
};

export default afterLoad;
