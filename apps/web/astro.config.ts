import mdx from "@astrojs/mdx";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";
import afterLoadDirective from "./src/directives/after-load-integration.ts";

// Spec 2.4: URLs never end in a slash; build.format "file" writes /pricing as dist/pricing.html.
export default defineConfig({
  site: process.env.PUBLIC_SITE_ORIGIN || "https://videozombiecouple.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [preact({ compat: false }), mdx(), afterLoadDirective()],
});
