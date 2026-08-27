import { defineConfig } from "wxt";

export default defineConfig({
  publicDir: "browser-extension/public",
  srcDir: "browser-extension",
  manifest: {
    name: "Vault Autofill",
    description: "Private in-browser executor for origin-bound vault autofill.",
    permissions: ["tabs", "webNavigation"],
    host_permissions: ["http://*/*", "https://*/*"],
  },
});
