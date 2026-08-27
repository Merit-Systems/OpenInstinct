import { defineConfig } from "wxt";

export default defineConfig({
  publicDir: "browser-extension/public",
  srcDir: "browser-extension",
  manifest: {
    name: "Eve Vault Autofill",
    description:
      "Private in-browser executor for origin-bound Eve vault autofill.",
    permissions: ["tabs", "webNavigation"],
    host_permissions: ["http://*/*", "https://*/*"],
  },
});
