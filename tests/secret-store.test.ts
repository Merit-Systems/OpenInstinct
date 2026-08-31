import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  deleteEncryptedSecret,
  readEncryptedSecret,
  writeEncryptedSecret,
} from "../db/services/secrets";

const mocks = vi.hoisted(() => ({
  encrypted: undefined as string | undefined,
  readEncryptedSecret: vi.fn<typeof readEncryptedSecret>(),
  writeEncryptedSecret: vi.fn<typeof writeEncryptedSecret>(),
}));

vi.mock("@/db/services/secrets", () => ({
  deleteEncryptedSecret: vi.fn<typeof deleteEncryptedSecret>(),
  readEncryptedSecret: mocks.readEncryptedSecret,
  writeEncryptedSecret: mocks.writeEncryptedSecret,
}));
vi.mock("@/lib/installation-secrets", () => ({
  getInstallationSecrets: () =>
    Promise.resolve({
      betterAuthSecret: Buffer.alloc(32, 7).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 8).toString("base64"),
      version: 1,
    }),
}));

import { readSecret, writeSecret } from "../lib/manager/server/secret-store";

const scope = { userId: "user-1", workspaceId: "workspace-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encrypted = undefined;
  mocks.writeEncryptedSecret.mockImplementation((_scope, _id, value) => {
    mocks.encrypted = value;
    return Promise.resolve();
  });
  mocks.readEncryptedSecret.mockImplementation(() =>
    Promise.resolve(mocks.encrypted)
  );
});

describe("vault secret store", () => {
  it("encrypts and decrypts with the provisioned installation key", async () => {
    await writeSecret({
      id: "credential-1",
      namespace: "vault",
      scope,
      value: "correct horse battery staple",
    });

    expect(mocks.encrypted).toMatch(/^v1\./u);
    expect(mocks.encrypted).not.toContain("correct horse battery staple");
    await expect(
      readSecret({ id: "credential-1", namespace: "vault", scope })
    ).resolves.toBe("correct horse battery staple");
  });

  it("binds ciphertext to its workspace and item id", async () => {
    await writeSecret({
      id: "credential-1",
      namespace: "vault",
      scope,
      value: "secret",
    });

    await expect(
      readSecret({ id: "credential-2", namespace: "vault", scope })
    ).rejects.toThrow(/authenticate|state/iu);
  });
});
