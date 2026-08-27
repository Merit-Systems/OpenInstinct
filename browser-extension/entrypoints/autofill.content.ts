import { defineContentScript } from "wxt/utils/define-content-script";
import { fillAutofillClaims } from "../lib/fill-engine";
import { inspectAutofillSurfaces } from "../lib/field-detector";
import { onMessage } from "../lib/messaging";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  noScriptStartedPostMessage: true,
  runAt: "document_start",
  main() {
    onMessage("inspectFrame", () => ({
      origin: location.origin,
      surfaces: inspectAutofillSurfaces(),
    }));
    onMessage("fillFrame", async ({ data }) => ({
      claims: await fillAutofillClaims(data),
      origin: location.origin,
    }));
  },
});
