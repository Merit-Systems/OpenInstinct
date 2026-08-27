import { defineContentScript } from "wxt/utils/define-content-script";
import type {
  AutofillInspection,
  VaultAutofillExtensionResult,
} from "../../lib/manager/vault-autofill-protocol";
import { fillAutofillClaims } from "../lib/fill-engine";
import { inspectAutofillSurfaces } from "../lib/field-detector";
import { onMessage, sendMessage } from "../lib/messaging";

interface AutofillContentRuntime {
  fill(envelope: string): Promise<VaultAutofillExtensionResult>;
  getPublicKey(): Promise<JsonWebKey>;
  inspect(): Promise<AutofillInspection>;
}

declare global {
  // Kernel invokes this from the extension's isolated execution world. Calls use
  // runtime messaging so Chrome wakes the Manifest V3 worker on demand.
  var vaultAutofillContentRuntime: AutofillContentRuntime | undefined;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  noScriptStartedPostMessage: true,
  runAt: "document_start",
  main() {
    globalThis.vaultAutofillContentRuntime = {
      fill: (envelope) => sendMessage("fill", envelope),
      getPublicKey: () => sendMessage("getPublicKey"),
      inspect: () => sendMessage("inspect"),
    };
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
