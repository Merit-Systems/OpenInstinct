import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  "node_modules",
]);
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

describe("Vitest project configuration", () => {
  it("collects colocated and integration tests into exactly one tier", async () => {
    const config = await readFile(
      new URL("../../vitest.config.ts", import.meta.url),
      "utf8"
    );
    const testFiles = await repositoryTestFiles(
      new URL("../../", import.meta.url)
    );

    expect(config).toContain(
      'const defaultTestInclude = "**/*.{test,spec}.?(c|m)[jt]s?(x)"'
    );
    expect(config).toContain("include: [defaultTestInclude]");
    expect(config).toMatch(
      /exclude:\s+\[\s+"\*\*\/node_modules\/\*\*",\s+"\*\*\/.next\/\*\*",\s+"tests\/integration\/\*\*",\s+(?:\/\/[^\n]*\s+)?"tests\/e2e\/\*\*",\s+\]/u
    );
    expect(config).toContain('include: ["tests/integration/**"]');
    expect(testFiles).not.toHaveLength(0);
    for (const path of testFiles) {
      // Colocated tests are unit tests; Playwright owns tests/e2e exclusively.
      const expectedMatches = path.startsWith("tests/e2e/") ? 0 : 1;
      const matchingProjects = [
        matchesUnitProject(path),
        path.startsWith("tests/integration/"),
      ].filter(Boolean);
      expect(matchingProjects).toHaveLength(expectedMatches);
    }
  });
});

async function repositoryTestFiles(root: URL, prefix = ""): Promise<string[]> {
  const entries = await readdir(new URL(prefix, root), { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) return [];
        return await repositoryTestFiles(root, `${path}/`);
      }
      return testFilePattern.test(path) ? [path] : [];
    })
  );
  return paths.flat();
}

function matchesUnitProject(path: string) {
  return (
    testFilePattern.test(path) &&
    !path.startsWith("tests/integration/") &&
    !path.startsWith("tests/e2e/")
  );
}
