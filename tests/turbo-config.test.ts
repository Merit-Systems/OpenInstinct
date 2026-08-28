import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const applicationEnvironment = [
  "BETTER_AUTH_*",
  "BLOB_*",
  "DATABASE_URL",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "LINQ_*",
  "NODE_ENV",
  "SECRET_ENCRYPTION_KEY",
  "VERCEL_ENV",
];
const runtimeEnvironment = [...applicationEnvironment, "VERCEL_OIDC_TOKEN"];

describe("Turbo configuration", () => {
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
    expect(turbo.tasks["dev:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["start:app"].passThroughEnv).toEqual(runtimeEnvironment);
  });

  it("provisions private Blob storage through one-click and existing-project setup", async () => {
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8"
    );
    const blobSetup = readme
      .split("### Browser image storage", 2)[1]
      ?.split("### Linq iMessage setup", 1)[0];

    expect(readme).toContain(
      "stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D"
    );
    expect(blobSetup).toContain(
      "vercel blob create-store open-instinct-images --access private --yes"
    );
    expect(blobSetup).toContain("BLOB_STORE_ID");
    expect(blobSetup).toContain("VERCEL_OIDC_TOKEN");
    expect(blobSetup).not.toContain("vercel env pull");
    expect(
      blobSetup?.match(/^pnpm exec vercel blob create-store .+$/gmu)
    ).toHaveLength(1);
  });
});
