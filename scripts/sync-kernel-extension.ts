import Kernel from "@onkernel/sdk";
import { createHash } from "node:crypto";
import {
  createReadStream,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { kernelExtensionEnv } from "./env/kernel-extension.ts";

const force = process.argv.includes("--force");

if (kernelExtensionEnv.VERCEL_ENV !== "production" && !force) {
  console.log(
    "Skipping Kernel extension sync outside a production deployment."
  );
} else {
  await syncKernelExtension();
}

async function syncKernelExtension() {
  const apiKey = kernelExtensionEnv.KERNEL_API_KEY;
  if (!apiKey)
    throw new Error("KERNEL_API_KEY is required to sync the extension.");

  const extensionName = kernelExtensionEnv.KERNEL_VAULT_AUTOFILL_EXTENSION;
  const outputDirectory = join(process.cwd(), ".output");
  const archives = readdirSync(outputDirectory).filter((name) =>
    name.endsWith("-chrome.zip")
  );
  const archiveName = archives[0];
  if (!archiveName || archives.length !== 1) {
    throw new Error(
      `Expected one Chrome extension archive in .output, found ${String(archives.length)}.`
    );
  }

  const archivePath = join(outputDirectory, archiveName);
  const archiveChecksum = checksum(readFileSync(archivePath));
  const client = new Kernel({ apiKey });
  const current = await getExtension(client, extensionName);

  if (current?.checksum === archiveChecksum) {
    console.log(`Kernel extension "${extensionName}" is current.`);
    return;
  }

  if (!current) {
    const uploaded = await uploadExtension(client, extensionName, archivePath);
    console.log(
      `Uploaded Kernel extension "${extensionName}" (${uploaded.id}).`
    );
    return;
  }

  const download = await client.extensions.download(current.id);
  const previousArchive = Buffer.from(await download.arrayBuffer());
  if (checksum(previousArchive) === archiveChecksum) {
    console.log(`Kernel extension "${extensionName}" is current.`);
    return;
  }

  await client.extensions.delete(current.id);
  try {
    const uploaded = await uploadExtension(client, extensionName, archivePath);
    console.log(
      `Updated Kernel extension "${extensionName}" (${uploaded.id}).`
    );
  } catch (uploadError) {
    const rollbackPath = join(outputDirectory, "kernel-extension-rollback.zip");
    writeFileSync(rollbackPath, previousArchive);
    try {
      await uploadExtension(client, extensionName, rollbackPath);
    } catch (rollbackError) {
      console.error(
        "Kernel extension update failed before rollback:",
        uploadError
      );
      throw new Error(
        `Kernel extension "${extensionName}" update and rollback both failed.`,
        { cause: rollbackError }
      );
    }
    throw uploadError;
  }
}

async function getExtension(client: Kernel, name: string) {
  try {
    return await client.extensions.get(name);
  } catch (error) {
    if (hasStatus(error, 404)) return undefined;
    throw error;
  }
}

function uploadExtension(client: Kernel, name: string, archivePath: string) {
  return client.extensions.upload({
    file: createReadStream(archivePath),
    name,
  });
}

function checksum(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hasStatus(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}
