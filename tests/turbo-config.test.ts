import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const applicationEnvironment = [
  "BETTER_AUTH_*",
  "DATABASE_URL",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "NODE_ENV",
  "SECRET_ENCRYPTION_KEY",
  "VERCEL_ENV",
];

describe("Turbo configuration", () => {
  it("includes the Eve service in the local production build", async () => {
    const packageManifest = z
      .object({ scripts: z.object({ build: z.string() }) })
      .parse(
        JSON.parse(
          await readFile(new URL("../package.json", import.meta.url), "utf8")
        )
      );

    expect(packageManifest.scripts.build).toContain("pnpm build:eve");
  });

  it("scopes application environment variables to their owning tasks", async () => {
    const turbo = z
      .object({
        tasks: z.object({
          "build:app": z.object({ env: z.array(z.string()) }),
          "build:vercel": z.object({ env: z.array(z.string()) }),
          "dev:app": z.object({ passThroughEnv: z.array(z.string()) }),
          "start:app": z.object({ passThroughEnv: z.array(z.string()) }),
        }),
      })
      .loose()
      .parse(
        JSON.parse(
          await readFile(new URL("../turbo.json", import.meta.url), "utf8")
        )
      );

    expect(turbo).not.toHaveProperty("globalEnv");
    expect(turbo.tasks["build:app"].env).toEqual(
      expect.arrayContaining([...applicationEnvironment, "EVE_NEXT_*"])
    );
    expect(turbo.tasks["build:app"].env).toHaveLength(
      applicationEnvironment.length + 1
    );
    expect(turbo.tasks["build:vercel"].env).toEqual(
      expect.arrayContaining([...applicationEnvironment, "VERCEL"])
    );
    expect(turbo.tasks["build:vercel"].env).toHaveLength(
      applicationEnvironment.length + 1
    );
    expect(turbo.tasks["dev:app"].passThroughEnv).toEqual(
      applicationEnvironment
    );
    expect(turbo.tasks["start:app"].passThroughEnv).toEqual(
      applicationEnvironment
    );
  });
});
