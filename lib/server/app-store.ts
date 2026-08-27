import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  agentSessions,
  browserSessions,
  chats,
  db,
  type Database,
  encryptedSecrets,
  settings,
  vaultItems,
  workspaceMemberships,
  workspaces,
} from "@/db";
import type { AccessScope } from "../access-scope";
import { chatListSchema, type ChatSummary, type SaveChat } from "../chat";
import { vaultItemKindSchema } from "../manager";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

const chatRowSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  createdAt: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string(),
});

const browserSessionRecordSchema = z.object({
  createdAt: z.string(),
  sessionId: z.string().min(1),
});

type BrowserSessionRecord = z.infer<typeof browserSessionRecordSchema>;
type VaultRecord = z.infer<typeof vaultRecordSchema>;

interface AppStore {
  claimSession(scope: AccessScope, sessionId: string): Promise<void>;
  createBrowserSession(
    scope: AccessScope,
    record: BrowserSessionRecord
  ): Promise<void>;
  createVaultItem(scope: AccessScope, record: VaultRecord): Promise<void>;
  deleteBrowserSession(scope: AccessScope, sessionId: string): Promise<boolean>;
  deleteEncryptedSecret(scope: AccessScope, id: string): Promise<void>;
  deleteVaultItem(scope: AccessScope, id: string): Promise<boolean>;
  ensureScope(scope: AccessScope): Promise<void>;
  isSessionOwned(scope: AccessScope, sessionId: string): Promise<boolean>;
  listBrowserSessions(
    scope: AccessScope
  ): Promise<readonly BrowserSessionRecord[]>;
  listChats(scope: AccessScope): Promise<readonly ChatSummary[]>;
  listOwnedSessionIds(scope: AccessScope): Promise<ReadonlySet<string>>;
  listVaultItems(scope: AccessScope): Promise<readonly VaultRecord[]>;
  readBrowserSession(
    scope: AccessScope,
    sessionId: string
  ): Promise<BrowserSessionRecord | undefined>;
  readEncryptedSecret(
    scope: AccessScope,
    id: string
  ): Promise<string | undefined>;
  readGatewayModel(scope: AccessScope): Promise<string | undefined>;
  saveChat(scope: AccessScope, chat: SaveChat): Promise<void>;
  selectGatewayModel(scope: AccessScope, modelId: string): Promise<void>;
  writeEncryptedSecret(
    scope: AccessScope,
    id: string,
    encryptedValue: string
  ): Promise<void>;
}

let storePromise: Promise<AppStore> | undefined;

export function getAppStore() {
  storePromise ??= createAppStore();
  return storePromise;
}

export async function createAppStore(database = db) {
  return createPostgresStore(database);
}

function createPostgresStore(database: Database): AppStore {
  async function ensureScope(scope: AccessScope) {
    const now = new Date().toISOString();
    await database.batch([
      database
        .insert(workspaces)
        .values({ createdAt: now, id: scope.workspaceId })
        .onConflictDoNothing({ target: workspaces.id }),
      database
        .insert(workspaceMemberships)
        .values({
          createdAt: now,
          role: "owner",
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        })
        .onConflictDoNothing({
          target: [
            workspaceMemberships.workspaceId,
            workspaceMemberships.userId,
          ],
        }),
    ]);
  }

  return {
    async claimSession(scope, sessionId) {
      await database
        .insert(agentSessions)
        .values({
          createdAt: new Date().toISOString(),
          createdByUserId: scope.userId,
          sessionId,
          workspaceId: scope.workspaceId,
        })
        .onConflictDoNothing({ target: agentSessions.sessionId });
    },
    async createBrowserSession(scope, record) {
      await database.insert(browserSessions).values({
        createdAt: record.createdAt,
        createdByUserId: scope.userId,
        sessionId: record.sessionId,
        workspaceId: scope.workspaceId,
      });
    },
    async createVaultItem(scope, record) {
      await database.insert(vaultItems).values({
        account: record.account,
        createdAt: record.createdAt,
        id: record.id,
        kind: record.kind,
        label: record.label,
        updatedAt: record.updatedAt,
        workspaceId: scope.workspaceId,
      });
    },
    async deleteBrowserSession(scope, sessionId) {
      const rows = await database
        .delete(browserSessions)
        .where(
          and(
            eq(browserSessions.workspaceId, scope.workspaceId),
            eq(browserSessions.sessionId, sessionId)
          )
        )
        .returning({ sessionId: browserSessions.sessionId });
      return rows.length > 0;
    },
    async deleteEncryptedSecret(scope, id) {
      await database
        .delete(encryptedSecrets)
        .where(
          and(
            eq(encryptedSecrets.workspaceId, scope.workspaceId),
            eq(encryptedSecrets.namespace, "vault"),
            eq(encryptedSecrets.id, id)
          )
        );
    },
    async deleteVaultItem(scope, id) {
      const rows = await database
        .delete(vaultItems)
        .where(
          and(
            eq(vaultItems.workspaceId, scope.workspaceId),
            eq(vaultItems.id, id)
          )
        )
        .returning({ id: vaultItems.id });
      return rows.length > 0;
    },
    ensureScope,
    async isSessionOwned(scope, sessionId) {
      const rows = await database
        .select({ sessionId: agentSessions.sessionId })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.workspaceId, scope.workspaceId),
            eq(agentSessions.sessionId, sessionId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },
    async listBrowserSessions(scope) {
      return browserSessionRecordSchema.array().parse(
        await database
          .select({
            createdAt: browserSessions.createdAt,
            sessionId: browserSessions.sessionId,
          })
          .from(browserSessions)
          .where(eq(browserSessions.workspaceId, scope.workspaceId))
          .orderBy(desc(browserSessions.createdAt))
      );
    },
    async listChats(scope) {
      const rows = chatRowSchema
        .array()
        .parse(
          await database
            .select()
            .from(chats)
            .where(eq(chats.workspaceId, scope.workspaceId))
            .orderBy(desc(chats.updatedAt))
        );
      return chatListSchema.parse(
        rows.map(({ costUsd, inputTokens, outputTokens, ...chat }) => ({
          ...chat,
          usage: { costUsd, inputTokens, outputTokens },
        }))
      );
    },
    async listOwnedSessionIds(scope) {
      const rows = z
        .array(z.object({ sessionId: z.string() }))
        .parse(
          await database
            .select({ sessionId: agentSessions.sessionId })
            .from(agentSessions)
            .where(eq(agentSessions.workspaceId, scope.workspaceId))
        );
      return new Set(rows.map((row) => row.sessionId));
    },
    async listVaultItems(scope) {
      return vaultRecordSchema.array().parse(
        await database
          .select({
            account: vaultItems.account,
            createdAt: vaultItems.createdAt,
            id: vaultItems.id,
            kind: vaultItems.kind,
            label: vaultItems.label,
            updatedAt: vaultItems.updatedAt,
          })
          .from(vaultItems)
          .where(eq(vaultItems.workspaceId, scope.workspaceId))
          .orderBy(desc(vaultItems.updatedAt))
      );
    },
    async readBrowserSession(scope, sessionId) {
      const rows = await database
        .select({
          createdAt: browserSessions.createdAt,
          sessionId: browserSessions.sessionId,
        })
        .from(browserSessions)
        .where(
          and(
            eq(browserSessions.workspaceId, scope.workspaceId),
            eq(browserSessions.sessionId, sessionId)
          )
        )
        .limit(1);
      return browserSessionRecordSchema.optional().parse(rows[0]);
    },
    async readEncryptedSecret(scope, id) {
      const rows = await database
        .select({ encryptedValue: encryptedSecrets.encryptedValue })
        .from(encryptedSecrets)
        .where(
          and(
            eq(encryptedSecrets.workspaceId, scope.workspaceId),
            eq(encryptedSecrets.namespace, "vault"),
            eq(encryptedSecrets.id, id)
          )
        )
        .limit(1);
      return z.object({ encryptedValue: z.string() }).optional().parse(rows[0])
        ?.encryptedValue;
    },
    async readGatewayModel(scope) {
      const rows = await database
        .select({ value: settings.value })
        .from(settings)
        .where(
          and(
            eq(settings.workspaceId, scope.workspaceId),
            eq(settings.key, "gateway_model")
          )
        )
        .limit(1);
      return z.object({ value: z.string() }).optional().parse(rows[0])?.value;
    },
    async saveChat(scope, chat) {
      await ensureScope(scope);
      const now = new Date().toISOString();
      const existing = await database
        .select({ sessionId: chats.sessionId })
        .from(chats)
        .where(
          and(
            eq(chats.workspaceId, scope.workspaceId),
            eq(chats.sessionId, chat.sessionId)
          )
        );
      if (existing.length === 0) {
        await database.insert(chats).values({
          costUsd: chat.usage?.costUsd ?? null,
          createdAt: now,
          inputTokens: chat.usage?.inputTokens ?? 0,
          outputTokens: chat.usage?.outputTokens ?? 0,
          sessionId: chat.sessionId,
          title: chat.title ?? "New chat",
          updatedAt: now,
          workspaceId: scope.workspaceId,
        });
        return;
      }
      await database
        .update(chats)
        .set({
          ...(chat.title === undefined ? {} : { title: chat.title }),
          ...(chat.usage === undefined
            ? {}
            : {
                costUsd: chat.usage.costUsd,
                inputTokens: chat.usage.inputTokens,
                outputTokens: chat.usage.outputTokens,
              }),
          updatedAt: now,
        })
        .where(
          and(
            eq(chats.workspaceId, scope.workspaceId),
            eq(chats.sessionId, chat.sessionId)
          )
        );
    },
    async selectGatewayModel(scope, modelId) {
      await database
        .insert(settings)
        .values({
          key: "gateway_model",
          value: modelId,
          workspaceId: scope.workspaceId,
        })
        .onConflictDoUpdate({
          target: [settings.workspaceId, settings.key],
          set: { value: modelId },
        });
    },
    async writeEncryptedSecret(scope, id, encryptedValue) {
      const updatedAt = new Date().toISOString();
      await database
        .insert(encryptedSecrets)
        .values({
          encryptedValue,
          id,
          namespace: "vault",
          updatedAt,
          workspaceId: scope.workspaceId,
        })
        .onConflictDoUpdate({
          target: [
            encryptedSecrets.workspaceId,
            encryptedSecrets.namespace,
            encryptedSecrets.id,
          ],
          set: { encryptedValue, updatedAt },
        });
    },
  };
}
