import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Durable Objects extend `DurableObject` from the Workers runtime module, which does not exist in
// Node; tests swap in a plain base class.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
