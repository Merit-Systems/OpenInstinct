import { z } from "zod";
import { createHash } from "node:crypto";

export const agentManifestSchema = z
  .object({
    version: z.literal(1),
    displayName: z.string().min(1).optional(),
    instructions: z.string().min(1).max(50_000),
    modelPolicy: z
      .object({ tier: z.string().min(1).optional() })
      .strict()
      .optional(),
    capabilities: z.array(z.string().min(1).max(200)).max(100),
  })
  .strict();

export type AgentManifest = z.infer<typeof agentManifestSchema>;
declare const canonicalJsonArrayBrand: unique symbol;
declare const canonicalJsonObjectBrand: unique symbol;
interface CanonicalJsonArray extends ReadonlyArray<CanonicalJsonValue> {
  readonly [canonicalJsonArrayBrand]?: never;
}
interface CanonicalJsonObject extends Readonly<
  Record<string, CanonicalJsonValue>
> {
  readonly [canonicalJsonObjectBrand]?: never;
}
type CanonicalJsonValue =
  | boolean
  | null
  | number
  | string
  | CanonicalJsonArray
  | CanonicalJsonObject;

export function canonicalAgentManifest(manifest: AgentManifest): AgentManifest {
  return agentManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));
}

export function agentManifestContentDigest(manifest: AgentManifest) {
  return createHash("sha256")
    .update(canonicalJson(canonicalAgentManifest(manifest)))
    .digest("hex");
}

function canonicalJson(value: CanonicalJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isCanonicalJsonRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new Error("Invalid canonical JSON.");
        return `${JSON.stringify(key)}:${canonicalJson(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isCanonicalJsonRecord(
  value: CanonicalJsonValue
): value is Readonly<Record<string, CanonicalJsonValue>> {
  return value instanceof Object && !Array.isArray(value);
}
