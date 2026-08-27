import { compactDecrypt, exportJWK, generateKeyPair } from "jose";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import type {
  AutofillClaim,
  AutofillInspection,
  AutofillSurfaceKind,
  VaultAutofillCommand,
  VaultAutofillExtensionResult,
  VaultAutofillFrameInspection,
} from "../../lib/vault-autofill-protocol";
import { vaultAutofillCommandSchema } from "../../lib/vault-autofill-protocol";
import { sendMessage } from "../lib/messaging";

const paymentFrameHosts = [
  "adyen.com",
  "authorize.net",
  "braintree-api.com",
  "braintreegateway.com",
  "cardconnect.com",
  "checkout.com",
  "cybersource.com",
  "squarecdn.com",
  "squareup.com",
  "spreedly.com",
  "stripe.com",
  "worldpay.com",
] as const;

interface AutofillRuntime {
  fill(envelope: string): Promise<VaultAutofillExtensionResult>;
  getPublicKey(): Promise<JsonWebKey>;
  inspect(): Promise<AutofillInspection>;
}

declare global {
  // Kernel Playwright calls this private service-worker capability directly.
  // It is never published into a merchant page.
  var eveVaultAutofillRuntime: AutofillRuntime | undefined;
}

export default defineBackground(() => {
  const keys = generateKeyPair("RSA-OAEP-256", { extractable: true });
  const consumedNonces = new Map<string, number>();

  globalThis.eveVaultAutofillRuntime = {
    async getPublicKey() {
      return exportJWK((await keys).publicKey);
    },
    async inspect() {
      return inspectActiveTab();
    },
    async fill(envelope) {
      const { plaintext } = await compactDecrypt(
        envelope,
        (await keys).privateKey
      );
      const command = parseCommand(new TextDecoder().decode(plaintext));
      consumeNonce(command, consumedNonces);
      return executeCommand(command);
    },
  };
});

async function executeCommand(
  command: VaultAutofillCommand
): Promise<VaultAutofillExtensionResult> {
  const { frames, inspection, tabId } = await inspectActiveTabFrames();
  if (inspection.origin !== command.expectedOrigin) {
    throw new Error("The active tab does not match the approved origin.");
  }
  if (!inspection.surfaces.some(({ id }) => id === command.surfaceId)) {
    throw new Error("The selected autofill surface is no longer present.");
  }

  const availableTokens = new Set(
    inspection.surfaces.flatMap(({ fields }) =>
      fields.map(({ token }) => token)
    )
  );
  const assignments = new Map<number, AutofillClaim[]>();
  const missing: AutofillClaim[] = [];

  for (const claim of command.claims) {
    if (!availableTokens.has(claim.token)) {
      missing.push(claim);
      continue;
    }

    const target = frames
      .map(({ frameId, inspection: frameInspection }) => ({
        frameId,
        origin: frameInspection?.origin ?? "",
        score: bestTokenScore(frameInspection, claim.token),
      }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference !== 0) return scoreDifference;
        if (left.origin === command.expectedOrigin) return -1;
        if (right.origin === command.expectedOrigin) return 1;
        return left.frameId - right.frameId;
      })[0];

    if (!target) {
      missing.push(claim);
      continue;
    }
    const frameClaims = assignments.get(target.frameId) ?? [];
    frameClaims.push(claim);
    assignments.set(target.frameId, frameClaims);
  }

  const frameResults = await Promise.all(
    [...assignments.entries()].map(([frameId, claims]) =>
      sendMessage("fillFrame", { claims }, { tabId, frameId })
    )
  );
  const claims = [
    ...frameResults.flatMap((result) => result.claims),
    ...missing.map(({ id }) => ({
      claimId: id,
      status: "missing" as const,
    })),
  ];

  return {
    claims,
    origin: command.expectedOrigin,
    success: claims.every(({ status }) => status === "filled"),
    surfaceId: command.surfaceId,
  };
}

async function inspectActiveTab() {
  return (await inspectActiveTabFrames()).inspection;
}

async function inspectActiveTabFrames() {
  const tab = await activeTab();
  const origin = exactOrigin(tab.url);
  const navigationFrames =
    (await browser.webNavigation.getAllFrames({ tabId: tab.id })) ?? [];
  const frames = await Promise.all(
    navigationFrames.map(async (frame) => ({
      frameId: frame.frameId,
      inspection: await inspectFrame(tab.id, frame.frameId),
    }))
  );
  const permittedFrames = frames.filter(({ inspection }) =>
    isPermittedFrame(origin, inspection)
  );

  return {
    frames: permittedFrames,
    inspection: {
      origin,
      surfaces: mergeSurfaces(permittedFrames),
    },
    tabId: tab.id,
  };
}

function mergeSurfaces(
  frames: readonly {
    readonly inspection: VaultAutofillFrameInspection | null;
  }[]
) {
  const surfaces = new Map<
    AutofillSurfaceKind,
    Map<string, { readonly score: number; readonly token: string }>
  >();

  for (const { inspection } of frames) {
    for (const surface of inspection?.surfaces ?? []) {
      const fields =
        surfaces.get(surface.kind) ??
        new Map<string, { readonly score: number; readonly token: string }>();
      for (const field of surface.fields) {
        const previous = fields.get(field.token);
        if (!previous || previous.score < field.score) {
          fields.set(field.token, field);
        }
      }
      surfaces.set(surface.kind, fields);
    }
  }

  const paymentFields = surfaces.get("payment-card");
  const postalCode = surfaces.get("postal-address")?.get("postal-code");
  if (paymentFields && postalCode) {
    paymentFields.set("postal-code", postalCode);
  }

  return [...surfaces.entries()].map(([kind, fields]) => ({
    fields: [...fields.values()].sort(
      (left, right) => right.score - left.score
    ),
    id: kind,
    kind,
  }));
}

function bestTokenScore(
  inspection: VaultAutofillFrameInspection | null,
  token: string
) {
  if (!inspection) return -1;
  return Math.max(
    -1,
    ...inspection.surfaces.flatMap(({ fields }) =>
      fields.filter((field) => field.token === token).map(({ score }) => score)
    )
  );
}

async function inspectFrame(tabId: number, frameId: number) {
  try {
    return await sendMessage("inspectFrame", undefined, { tabId, frameId });
  } catch {
    return null;
  }
}

function isPermittedFrame(
  expectedOrigin: string,
  inspection: VaultAutofillFrameInspection | null
) {
  if (!inspection || inspection.surfaces.length === 0) return false;
  if (inspection.origin === expectedOrigin) return true;
  try {
    const hostname = new URL(inspection.origin).hostname;
    return paymentFrameHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

async function activeTab() {
  const [tab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (tab?.id === undefined)
    throw new Error("No active browser tab was found.");
  return { id: tab.id, url: tab.url };
}

function exactOrigin(url: string | undefined) {
  if (!url) throw new Error("The active browser tab has no URL.");
  return new URL(url).origin;
}

function parseCommand(value: string) {
  const command = vaultAutofillCommandSchema.parse(JSON.parse(value));
  const now = Date.now();
  if (
    new URL(command.expectedOrigin).origin !== command.expectedOrigin ||
    command.issuedAt > now + 5_000 ||
    command.expiresAt < now ||
    command.expiresAt - command.issuedAt > 30_000
  ) {
    throw new Error("The vault autofill command is invalid or expired.");
  }
  return command;
}

function consumeNonce(
  command: VaultAutofillCommand,
  consumedNonces: Map<string, number>
) {
  const now = Date.now();
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt < now) consumedNonces.delete(nonce);
  }
  if (consumedNonces.has(command.nonce)) {
    throw new Error("The vault autofill command has already been used.");
  }
  consumedNonces.set(command.nonce, command.expiresAt);
}
