import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const allowedSrcDirectories = [
  "app",
  "auth",
  "components",
  "hooks",
  "lib",
  "trpc",
];

const expectedSrcFiles = ["env.ts", "proxy.ts"];

const disallowedLibDirectories = [
  "browser",
  "browser-images",
  "google-workspace",
  "manager",
  "model-catalog",
  "task-history",
];

const expectedLibFiles = [
  "access-scope.ts",
  "admin.ts",
  "agent-manifest.ts",
  "application-origin.ts",
  "browser-artifact.ts",
  "chat.ts",
  "google-workspace.ts",
  "installation-secrets.ts",
  "kernel.ts",
  "request-scope.ts",
  "same-origin.ts",
  "utils.ts",
  "vault.ts",
  "worker-completion.ts",
  "worker-events.ts",
];

function directories(directory: string) {
  return readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isDirectory())
    .toSorted();
}

function files(directory: string) {
  return readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isFile())
    .toSorted();
}

describe("source layout", () => {
  it("keeps src limited to application layers", () => {
    expect(directories("src")).toEqual(allowedSrcDirectories);
    expect(files("src")).toEqual(expectedSrcFiles);
  });

  it("keeps lib limited to shared infrastructure and contracts", () => {
    const libDirectories = directories("src/lib");

    for (const directory of disallowedLibDirectories) {
      expect(libDirectories).not.toContain(directory);
    }
    expect(files("src/lib")).toEqual(expectedLibFiles);
  });
});
