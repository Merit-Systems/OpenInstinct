import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("init.sh", () => {
  it("keeps help and check non-mutating", async () => {
    const directory = await fixture();
    const before = await readdir(directory);

    const help = await runInit(directory, ["--help"]);
    const check = await runInit(directory, ["--check"]);

    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--setup-only");
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("Prerequisites are available.");
    expect(await readdir(directory)).toEqual(before);
  });

  it("copies a private env template and stops with setup guidance", async () => {
    const directory = await fixture();
    const result = await runInit(directory);
    const created = await readFile(join(directory, ".env.local"), "utf8");
    const template = await readFile(join(directory, ".env.example"), "utf8");

    expect(result.code).toBe(1);
    expect(created).toBe(template);
    expect(result.stderr).toContain("KERNEL_API_KEY");
    expect(result.stderr).toContain("000000");
    expect((await stat(join(directory, ".env.local"))).mode & 0o777).toBe(
      0o600
    );
    expect(result.stdout).not.toContain("KERNEL_API_KEY=");
  });

  it("preserves an existing env and installs during setup-only", async () => {
    const directory = await fixture();
    const existing = "KERNEL_API_KEY=placeholder-only\nCUSTOM=value\n";
    await writeFile(join(directory, ".env.local"), existing, { mode: 0o644 });

    const result = await runInit(directory, ["--setup-only"]);

    expect(result.code).toBe(0);
    expect(await readFile(join(directory, ".env.local"), "utf8")).toBe(
      existing
    );
    expect((await stat(join(directory, ".env.local"))).mode & 0o777).toBe(
      0o600
    );
    expect(await readFile(join(directory, "commands.log"), "utf8")).toBe(
      "pnpm install --frozen-lockfile\n"
    );
  });

  it("accepts comments, whitespace, and equals signs in the kernel key", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, ".env.local"),
      "  # local-only comment\n  KERNEL_API_KEY = token=with=equals\n",
      { mode: 0o600 }
    );

    const result = await runInit(directory, ["--setup-only"]);

    expect(result.code).toBe(0);
    expect(await readFile(join(directory, "commands.log"), "utf8")).toBe(
      "pnpm install --frozen-lockfile\n"
    );
  });

  it("stops when the kernel key is missing or empty without printing its value", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, ".env.local"),
      "# no key here\nKERNEL_API_KEY=   \n",
      { mode: 0o600 }
    );

    const result = await runInit(directory, ["--setup-only"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("KERNEL_API_KEY is missing or empty");
    expect(result.stdout).not.toContain("KERNEL_API_KEY=");
    expect(await readFile(join(directory, "commands.log"), "utf8")).toBe("");
  });

  it("skips installation and delegates the default lifecycle to pnpm dev", async () => {
    const directory = await fixture();
    await writeFile(join(directory, ".env.local"), "KERNEL_API_KEY=test\n", {
      mode: 0o600,
    });

    const result = await runInit(directory, ["--skip-install"]);

    expect(result.code).toBe(0);
    expect(await readFile(join(directory, "commands.log"), "utf8")).toBe(
      "pnpm dev\n"
    );
  });

  it("reports missing and incompatible prerequisites", async () => {
    const missing = await fixture({ omit: "pnpm" });
    const missingResult = await runInit(missing, ["--check"]);
    expect(missingResult.code).toBe(1);
    expect(missingResult.stderr).toContain("Missing prerequisite: pnpm");

    const wrongNode = await fixture({ nodeVersion: "v22.1.0" });
    const wrongNodeResult = await runInit(wrongNode, ["--check"]);
    expect(wrongNodeResult.code).toBe(1);
    expect(wrongNodeResult.stderr).toContain("Node 24 is required");

    const noCompose = await fixture({ dockerCompose: false });
    const noComposeResult = await runInit(noCompose, ["--check"]);
    expect(noComposeResult.code).toBe(1);
    expect(noComposeResult.stderr).toContain("Docker Compose v2 is required");

    const noDaemon = await fixture({ dockerDaemon: false });
    const noDaemonResult = await runInit(noDaemon, ["--check"]);
    expect(noDaemonResult.code).toBe(1);
    expect(noDaemonResult.stderr).toContain("Docker daemon is unavailable");
  });

  it("rejects unknown flags", async () => {
    const directory = await fixture();
    const result = await runInit(directory, ["--not-a-real-option"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option: --not-a-real-option");
  });
});

async function fixture(
  options: {
    readonly dockerCompose?: boolean;
    readonly dockerDaemon?: boolean;
    readonly nodeVersion?: string;
    readonly omit?: "pnpm";
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "open-instinct-init-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  await (await import("node:fs/promises")).mkdir(bin);
  await Promise.all([
    writeFile(
      join(directory, "init.sh"),
      await readFile(new URL("../../init.sh", import.meta.url)),
      { mode: 0o755 }
    ),
    writeFile(
      join(directory, ".env.example"),
      await readFile(new URL("../../.env.example", import.meta.url))
    ),
    writeExecutable(
      join(bin, "node"),
      `#!/bin/sh\nprintf '%s\\n' "${options.nodeVersion ?? "v24.15.0"}"\n`
    ),
    writeExecutable(
      join(bin, "docker"),
      `#!/bin/sh\nif [ "$1" = "compose" ] && [ "$2" = "version" ]; then\n  ${options.dockerCompose === false ? "exit 1" : "exit 0"}\nfi\nif [ "$1" = "info" ]; then\n  ${options.dockerDaemon === false ? "exit 1" : "exit 0"}\nfi\nexit 0\n`
    ),
    writeFile(join(directory, "commands.log"), ""),
  ]);
  if (options.omit !== "pnpm") {
    await writeExecutable(
      join(bin, "pnpm"),
      `#!/bin/sh\nprintf 'pnpm %s\\n' "$*" >> "$INIT_LOG"\n`
    );
  }
  return directory;
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents, { mode: 0o755 });
  await chmod(path, 0o755);
}

async function runInit(directory: string, args: readonly string[] = []) {
  const bin = join(directory, "bin");
  const result = spawnSync("/bin/bash", [join(directory, "init.sh"), ...args], {
    cwd: directory,
    env: {
      INIT_LOG: join(directory, "commands.log"),
      NODE_ENV: "test",
      PATH: `${bin}:/usr/bin:/bin`,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}
