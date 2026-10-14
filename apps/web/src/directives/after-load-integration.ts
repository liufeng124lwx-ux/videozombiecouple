import type { AstroIntegration } from "astro";

/** Registers `client:after-load` (see ./after-load.ts). */
export default function afterLoadDirective(): AstroIntegration {
  return {
    name: "after-load-directive",
    hooks: {
      "astro:config:setup": ({ addClientDirective }) => {
        addClientDirective({
          name: "after-load",
          entrypoint: new URL("./after-load.ts", import.meta.url).pathname,
        });
      },
    },
  };
}
