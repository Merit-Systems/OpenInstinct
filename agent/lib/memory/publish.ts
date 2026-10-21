import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { registerMemoryJobArtifacts } from "@db/services/memory/artifacts";
import { followMemoryLinks } from "@db/services/memory/records";
import type { AccessScope } from "@shared/identity/access-scope";
import { env } from "@shared/environment";
import type {
  MemoryProposal,
  MemoryRecordContent,
} from "@shared/memory/schema";

interface Snapshot {
  id: string;
  revision: number;
  content: MemoryRecordContent;
}

function memorySnapshotMarkdown(
  record: Snapshot,
  links: MemoryProposal["links"]
) {
  const { body, title, ...metadata } = record.content;
  return [
    `# ${title.replace(/[\r\n]/gu, " ")}`,
    "",
    body,
    "",
    "## Links",
    "",
    "Resolve logical memory:record links with knowledge__read using the record ID.",
    ...links.map(
      (link) =>
        `- [Related memory](memory:record/${encodeURIComponent(link.fromId === record.id ? link.toId : link.fromId)}) (co-mentioned)`
    ),
    "",
    "## Provenance",
    "",
    "```json",
    JSON.stringify(
      { id: record.id, revision: record.revision, ...metadata, links },
      null,
      2
    ),
    "```",
    "",
  ].join("\n");
}

export async function uploadKnowledgeArtifacts(
  scope: AccessScope,
  scopeKey: string,
  job: { id: string; leaseToken: string },
  records: readonly Snapshot[],
  abortSignal: AbortSignal,
  proposal: MemoryProposal = { records: [], links: [] }
) {
  if (!records.length) return [];
  const namespace = createHash("sha256")
    .update(JSON.stringify([scope.workspaceId, scopeKey]))
    .digest("hex");
  const changed = new Set(proposal.records.map((record) => record.id));
  const snapshots = await Promise.all(
    records.map(async (record) => {
      const graph = await followMemoryLinks(scope, scopeKey, record.id);
      const endpoints = new Map(
        [...graph.records, ...records].map((endpoint) => [
          endpoint.id,
          endpoint,
        ])
      );
      const candidates = [
        ...graph.links.filter(
          (link) => !changed.has(link.fromId) && !changed.has(link.toId)
        ),
        ...proposal.links,
      ];
      const supported = candidates.filter((link) => {
        if (
          link.relation !== "co-mentioned" ||
          (link.fromId !== record.id && link.toId !== record.id)
        )
          return false;
        const from = endpoints.get(link.fromId);
        const to = endpoints.get(link.toId);
        return (
          from &&
          to &&
          from.id !== to.id &&
          from.content.evidence.some((span) =>
            to.content.evidence.some(
              (other) => other.sourceId === span.sourceId
            )
          )
        );
      });
      const links = [
        ...new Map(
          supported.map(({ fromId, toId, relation }) => [
            JSON.stringify([fromId, toId, relation]),
            { fromId, toId, relation },
          ])
        ).values(),
      ]
        .toSorted((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        )
        .slice(0, 40);
      const markdown = memorySnapshotMarkdown(record, links);
      const sha256 = createHash("sha256").update(markdown).digest("hex");
      return {
        markdown,
        artifact: {
          pathname: `memory/${namespace}/${job.id}/${job.leaseToken}/${sha256}.md`,
          sha256,
          recordId: record.id,
          revision: record.revision,
        },
      };
    })
  );
  const artifacts = await registerMemoryJobArtifacts(
    scope,
    scopeKey,
    job.id,
    job.leaseToken,
    snapshots.map(({ artifact }) => artifact)
  );
  await Promise.all(
    snapshots.map(async ({ markdown, artifact }) => {
      abortSignal.throwIfAborted();
      await put(artifact.pathname, markdown, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        abortSignal,
        contentType: "text/markdown; charset=utf-8",
        maximumSizeInBytes: 32_000,
        storeId: env.BLOB_STORE_ID,
        token: env.BLOB_READ_WRITE_TOKEN,
      });
    })
  );
  return artifacts;
}
