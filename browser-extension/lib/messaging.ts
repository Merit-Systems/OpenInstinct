import { defineExtensionMessaging } from "@webext-core/messaging";
import type {
  VaultAutofillFrameFillRequest,
  VaultAutofillFrameFillResult,
  VaultAutofillFrameInspection,
} from "../../lib/manager/vault-autofill-protocol";

interface VaultAutofillMessagingProtocol {
  fillFrame(input: VaultAutofillFrameFillRequest): VaultAutofillFrameFillResult;
  inspectFrame(): VaultAutofillFrameInspection;
}

export const { onMessage, sendMessage } =
  defineExtensionMessaging<VaultAutofillMessagingProtocol>();
