import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const allowedSrcDirectories = [
  "app",
  "auth",
  "components",
  "hooks",
  "lib",
  "modules",
  "trpc",
];

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
  "browser-artifact.ts",
  "chat.ts",
  "env.ts",
  "google-workspace.ts",
  "kernel.ts",
  "request-scope.ts",
  "same-origin.ts",
  "utils.ts",
  "worker-completion.ts",
  "worker-events.ts",
];

const expectedModuleDirectories = ["manager"];

const expectedModuleFiles: string[] = [];

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
  it("keeps feature-owned code under modules instead of src root", () => {
    expect(directories("src")).toEqual(allowedSrcDirectories);
  });

  it("keeps lib limited to shared infrastructure and contracts", () => {
    const libDirectories = directories("src/lib");

    for (const directory of disallowedLibDirectories) {
      expect(libDirectories).not.toContain(directory);
    }
    expect(files("src/lib")).toEqual(expectedLibFiles);
  });

  it("keeps modules limited to cross-cutting product domains", () => {
    expect(directories("src/modules")).toEqual(expectedModuleDirectories);
    expect(files("src/modules")).toEqual(expectedModuleFiles);
  });
});
