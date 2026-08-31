import { randomUUID } from "node:crypto";
import {
  getTokenResponse,
  NoValidTokenError,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { ensureScope } from "@/db/services/scope";
import { getGatewayModel, selectGatewayModel } from "@/db/services/settings";
import {
  createVaultItem as insertVaultItem,
  deleteVaultItem,
} from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { env } from "@/lib/env";
import { googleWorkspaceTokenParams } from "@/lib/google-workspace";
import type { ManagerMutation } from "..";
import { parsePaymentCardSecret, paymentCardBrand } from "../payment-card";
import { loginAccountHint, parseLoginVaultPayload } from "../vault-payload";
import { deleteSecret, secretStoreStatus, writeSecret } from "./secret-store";
import { readManagerVaultItems } from "./vault";

export async function readManagerSnapshot(scope: AccessScope) {
  const [googleWorkspace, vaultRows, gatewayModel] = await Promise.all([
    getGoogleWorkspaceConnection(scope),
    readManagerVaultItems(scope),
    getGatewayModel(scope),
  ]);

  return {
    browser: { available: true },
    googleWorkspace,
    runtime: { inference: gatewayModel },
    secretStore: secretStoreStatus(),
    vaultItems: vaultRows,
  };
}

async function getGoogleWorkspaceConnection(scope: AccessScope) {
  try {
    const response = await getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
    return {
      accountLabel:
        response.name ??
        (typeof response.claims?.email === "string"
          ? response.claims.email
          : null),
      state: "connected" as const,
    };
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      return { accountLabel: null, state: "disconnected" as const };
    }
    return { accountLabel: null, state: "unavailable" as const };
  }
}

export async function applyManagerMutation(
  scope: AccessScope,
  mutation: ManagerMutation
) {
  await ensureScope(scope);

  switch (mutation.action) {
    case "model.select":
      await selectGatewayModel(scope, mutation.modelId);
      break;
    case "vault.create":
      await createVaultItem(scope, mutation.input);
      break;
    case "vault.import":
      for (const item of mutation.items) await createVaultItem(scope, item);
      break;
    case "vault.delete":
      await removeVaultItem(scope, mutation.id);
      break;
  }

  return readManagerSnapshot(scope);
}

async function createVaultItem(
  scope: AccessScope,
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeSecret({ id, namespace: "vault", scope, value: input.secret });

  try {
    await insertVaultItem(scope, {
      account: vaultAccountHint(input),
      createdAt: now,
      id,
      kind: input.kind,
      label: input.label,
      updatedAt: now,
    });
  } catch (error) {
    await deleteSecret({ id, namespace: "vault", scope });
    throw error;
  }
}

function vaultAccountHint(
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  switch (input.kind) {
    case "login": {
      const payload = parseLoginVaultPayload(input.secret);
      if (!payload)
        throw new Error("The saved login is incomplete or invalid.");
      return loginAccountHint(
        payload.identifier,
        "origin" in payload ? payload.origin : undefined
      );
    }
    case "payment": {
      const card = parsePaymentCardSecret(input.secret);
      return `${paymentCardBrand(card.number)} · •••• ${card.number.slice(-4)}`;
    }
    case "address":
    case "contact":
      return "";
  }
}

async function removeVaultItem(scope: AccessScope, id: string) {
  const deleted = await deleteVaultItem(scope, id);
  if (!deleted) return;
  await deleteSecret({ id, namespace: "vault", scope });
}
