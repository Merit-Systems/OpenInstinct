import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSecret,
  secretStoreDependencies,
  writeSecret,
} from "@/lib/manager/server/secret-store";

const readEncryptedSecretMock = vi.spyOn(
  secretStoreDependencies,
  "readEncryptedSecret"
);
const writeEncryptedSecretMock = vi.spyOn(
  secretStoreDependencies,
  "writeEncryptedSecret"
);
const getInstallationSecretsMock = vi.spyOn(
  secretStoreDependencies,
  "getInstallationSecrets"
);
const scope = { userId: "user-1", workspaceId: "workspace-1" };
let encrypted: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  encrypted = undefined;
  getInstallationSecretsMock.mockResolvedValue({
    betterAuthSecret: Buffer.alloc(32, 7).toString("base64"),
    secretEncryptionKey: Buffer.alloc(32, 8).toString("base64"),
    version: 1,
  });
  writeEncryptedSecretMock.mockImplementation((_scope, _id, value) => {
    encrypted = value;
    return Promise.resolve();
  });
  readEncryptedSecretMock.mockImplementation(() => Promise.resolve(encrypted));
});

describe("vault secret store", () => {
  it("encrypts and decrypts with the provisioned installation key", async () => {
    await writeSecret({
      id: "credential-1",
      namespace: "vault",
      scope,
      value: "correct horse battery staple",
    });

    expect(encrypted).toMatch(/^v1\./u);
    expect(encrypted).not.toContain("correct horse battery staple");
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
