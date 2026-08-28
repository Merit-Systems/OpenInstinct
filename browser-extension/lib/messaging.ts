import { defineExtensionMessaging } from "@webext-core/messaging";
import type {
  AutofillInspection,
  VaultAutofillFrameFillRequest,
  VaultAutofillFrameFillResult,
  VaultAutofillFrameInspection,
  VaultAutofillExtensionResult,
} from "../../lib/vault-autofill-protocol";

interface VaultAutofillMessagingProtocol {
  fill(envelope: string): VaultAutofillExtensionResult;
  fillFrame(input: VaultAutofillFrameFillRequest): VaultAutofillFrameFillResult;
  getPublicKey(): JsonWebKey;
  inspect(): AutofillInspection;
  inspectFrame(): VaultAutofillFrameInspection;
}

export const { onMessage, sendMessage } =
  defineExtensionMessaging<VaultAutofillMessagingProtocol>();
