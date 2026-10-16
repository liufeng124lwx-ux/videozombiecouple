/**
 * Long reads are folded on phones (CSS, `[data-fold]`); the text is in the page from the start, so
 * search engines read it all. The button opens its own section and moves focus into it.
 */
export function wireFolds(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-unfold]")) {
    button.addEventListener("click", () => {
      const section = button.closest("section");
      const text = section?.querySelector<HTMLElement>("[data-fold]");
      if (!text) return;
      text.removeAttribute("data-fold");
      text.tabIndex = -1;
      text.focus({ preventScroll: true });
      button.closest(".fold-more")?.remove();
    });
  }
}
