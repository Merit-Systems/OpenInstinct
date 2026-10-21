"use client";

import Link from "next/link";
import { z } from "zod";
import { type SubmitEvent, useState } from "react";
import { DownloadIcon, PlusIcon } from "lucide-react";
import {
  editMemoryRecordSchema,
  memoryKindSchema,
} from "@shared/memory/schema";
import { api } from "@web/trpc/client";
import type { RouterOutputs } from "@web/trpc/types";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select";
import { Textarea } from "@web/components/ui/textarea";

export function MemoryBrowser({
  mode,
}: {
  readonly mode: "shadow" | "enabled";
}) {
  const bindings = api.memory.bindings.useQuery();
  const [selected, setSelected] = useState<string>();
  const sessionId = selected ?? bindings.data?.[0]?.sessionId;

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="type-page-title">Memory</h1>
        <p className="type-body max-w-2xl text-muted-foreground">
          Inspect what your assistant remembers, see its sources, and correct or
          forget a fact.
        </p>
        {mode === "shadow" ? (
          <p className="type-supporting-body text-muted-foreground">
            Preview mode: these memories are being collected but are not used in
            replies.
          </p>
        ) : null}
      </header>
      {bindings.isPending ? (
        <output className="type-supporting-body text-muted-foreground">
          Loading memory…
        </output>
      ) : bindings.isError ? (
        <MemoryError
          message="Couldn't load your memory collections."
          retry={() => void bindings.refetch()}
        />
      ) : !bindings.data.length ? (
        <section className="space-y-4 rounded-xl border border-border p-6">
          <h2 className="type-section-title">
            Memory starts with a conversation
          </h2>
          <p className="type-supporting-body text-muted-foreground">
            Start a chat, then return here to inspect or add memories.
          </p>
          <Button nativeButton={false} render={<Link href="/chat" />}>
            Open chat
          </Button>
        </section>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="memory-chat">Chat</Label>
            <Select
              value={sessionId}
              onValueChange={(value) => {
                if (value) setSelected(value);
              }}
            >
              <SelectTrigger id="memory-chat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bindings.data.map((binding) => (
                  <SelectItem key={binding.sessionId} value={binding.sessionId}>
                    Chat {binding.sessionId.slice(-8)} ·{" "}
                    {dateLabel(binding.updatedAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="type-caption text-muted-foreground">
              Chats in the same collection share their saved memories.
            </p>
          </div>
          {sessionId ? (
            <MemoryCollection key={sessionId} sessionId={sessionId} />
          ) : null}
        </>
      )}
    </div>
  );
}

function MemoryCollection({ sessionId }: { readonly sessionId: string }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const records = api.memory.list.useQuery({
    sessionId,
    query,
    offset,
    includeHistorical,
  });
  const utils = api.useUtils();

  const exportRecords = async (format: "json" | "markdown") => {
    setExportError(false);
    setExporting(true);
    try {
      const data = await utils.memory.export.fetch({ sessionId });
      const url = URL.createObjectURL(
        new Blob(
          [
            format === "json"
              ? JSON.stringify(data, null, 2)
              : memoryMarkdown(data),
          ],
          { type: format === "json" ? "application/json" : "text/markdown" }
        )
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `openinstinct-memory.${format === "json" ? "json" : "md"}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const search = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = z
      .string()
      .safeParse(new FormData(event.currentTarget).get("query"));
    setQuery(value.success ? value.data : "");
    setOffset(0);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setCreating(true);
            setSelectedId(undefined);
          }}
        >
          <PlusIcon />
          Remember a fact
        </Button>
        <Button
          disabled={exporting}
          onClick={() => void exportRecords("markdown")}
          variant="outline"
        >
          <DownloadIcon />
          {exporting ? "Exporting…" : "Export Markdown"}
        </Button>
      </div>
      <Button
        disabled={exporting}
        onClick={() => void exportRecords("json")}
        variant="quiet"
        className="self-start"
      >
        Export JSON with source data
      </Button>
      {notice ? (
        <output className="type-supporting-body text-muted-foreground">
          {notice}
        </output>
      ) : null}
      {exportError ? (
        <MemoryError message="Couldn't export memory. Try again." />
      ) : null}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <section aria-label="Saved memories" className="min-w-0 space-y-4">
          <form className="flex gap-2" onSubmit={search}>
            <Label className="sr-only" htmlFor="memory-search">
              Search memories
            </Label>
            <Input
              id="memory-search"
              name="query"
              type="search"
              placeholder="Search memories"
              maxLength={200}
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <Button
            aria-pressed={includeHistorical}
            onClick={() => {
              setIncludeHistorical((value) => !value);
              setOffset(0);
            }}
            variant="quiet"
            size="sm"
          >
            {includeHistorical ? "Hide older records" : "Include older records"}
          </Button>
          {records.isPending ? (
            <output className="type-supporting-body text-muted-foreground">
              Loading records…
            </output>
          ) : records.isError ? (
            <MemoryError
              message="Couldn't load memories."
              retry={() => void records.refetch()}
            />
          ) : (
            <>
              <div className="divide-y divide-border/50 rounded-xl border border-border/50">
                {records.data.items.length ? (
                  records.data.items.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      aria-pressed={selectedId === record.id}
                      className="w-full space-y-1 rounded-lg p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
                      onClick={() => {
                        setCreating(false);
                        setSelectedId(record.id);
                      }}
                    >
                      <p className="type-label wrap-break-word">
                        {record.content.title}
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {record.content.kind} · {record.content.status} ·{" "}
                        {dateLabel(record.updatedAt)}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="type-supporting-body p-5 text-muted-foreground">
                    {query
                      ? "No memories match this search."
                      : "No saved memories yet. Add a fact you want your assistant to remember."}
                  </p>
                )}
              </div>
              <div className="flex justify-between gap-2">
                <Button
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 20));
                  }}
                  variant="quiet"
                  size="sm"
                >
                  Previous
                </Button>
                <Button
                  disabled={records.data.nextOffset === null}
                  onClick={() => {
                    setOffset(records.data.nextOffset ?? offset);
                  }}
                  variant="quiet"
                  size="sm"
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </section>
        <section
          aria-label="Memory details"
          className="min-w-0 rounded-xl border border-border p-4 sm:p-6"
        >
          {creating ? (
            <MemoryEditor
              key="new"
              sessionId={sessionId}
              onSaved={(id) => {
                setCreating(false);
                setSelectedId(id);
                setNotice("Memory saved.");
              }}
              onCancel={() => {
                setCreating(false);
              }}
            />
          ) : selectedId ? (
            <MemoryDetails
              key={selectedId}
              id={selectedId}
              sessionId={sessionId}
              onForgotten={() => {
                setSelectedId(undefined);
                setNotice("Memory forgotten. Original chats are unchanged.");
              }}
              onSaved={() => {
                setNotice("Correction saved.");
              }}
            />
          ) : (
            <p className="type-supporting-body text-muted-foreground">
              Select a memory to inspect its evidence and history, or remember a
              new fact.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function MemoryDetails({
  id,
  sessionId,
  onForgotten,
  onSaved,
}: {
  readonly id: string;
  readonly sessionId: string;
  readonly onForgotten: () => void;
  readonly onSaved: () => void;
}) {
  const record = api.memory.read.useQuery({ id, sessionId });
  const history = api.memory.history.useQuery({ id, sessionId });
  if (record.isPending)
    return (
      <output className="type-supporting-body text-muted-foreground">
        Loading memory…
      </output>
    );
  if (record.isError)
    return (
      <MemoryError
        message="Couldn't load this memory."
        retry={() => void record.refetch()}
      />
    );
  if (!record.data)
    return (
      <p className="type-supporting-body text-muted-foreground">
        This memory is no longer available.
      </p>
    );
  const savedRecord = record.data;
  return (
    <div className="space-y-8">
      <MemoryEditor
        key={`${id}:${String(savedRecord.revision)}`}
        sessionId={sessionId}
        record={savedRecord}
        onSaved={onSaved}
        onForgotten={onForgotten}
      />
      <section className="space-y-3" aria-labelledby="memory-evidence">
        <h3 id="memory-evidence" className="type-label">
          Evidence
        </h3>
        {savedRecord.content.evidence.map((evidence) => {
          const source = savedRecord.sources.find(
            (item) => item.id === evidence.sourceId
          );
          return (
            <div
              key={`${evidence.sourceId}:${String(evidence.start)}`}
              className="space-y-2 rounded-lg bg-muted/50 p-3"
            >
              <p className="type-caption text-muted-foreground">
                {source?.kind === "user_edit"
                  ? "Your saved correction"
                  : source?.kind === "legacy"
                    ? "Earlier saved memory"
                    : "Conversation evidence"}
                {source
                  ? ` · ${dateLabel(source.observedAt)}`
                  : " · Source unavailable"}
              </p>
              <blockquote className="type-supporting-body wrap-break-word whitespace-pre-wrap">
                {source?.text?.slice(evidence.start, evidence.end) ??
                  "The original evidence is unavailable."}
              </blockquote>
            </div>
          );
        })}
      </section>
      <details className="space-y-3 border-t border-border/50 pt-4">
        <summary className="cursor-pointer type-label">
          Revision history
        </summary>
        {history.isPending ? (
          <p className="type-supporting-body text-muted-foreground">
            Loading history…
          </p>
        ) : history.isError ? (
          <MemoryError
            message="Couldn't load revision history."
            retry={() => void history.refetch()}
          />
        ) : history.data.length ? (
          history.data.map((revision) => (
            <article
              key={revision.revision}
              className="space-y-2 border-l-2 border-border pl-3"
            >
              <p className="type-caption text-muted-foreground">
                Revision {revision.revision} · {dateLabel(revision.createdAt)}
              </p>
              <p className="type-supporting-body wrap-break-word whitespace-pre-wrap">
                {revision.content.body}
              </p>
            </article>
          ))
        ) : (
          <p className="type-supporting-body text-muted-foreground">
            No earlier revisions.
          </p>
        )}
      </details>
    </div>
  );
}

function MemoryEditor({
  sessionId,
  record,
  onSaved,
  onForgotten,
  onCancel,
}: {
  readonly sessionId: string;
  readonly record?: NonNullable<RouterOutputs["memory"]["read"]>;
  readonly onSaved: (id: string) => void;
  readonly onForgotten?: () => void;
  readonly onCancel?: () => void;
}) {
  const utils = api.useUtils();
  const save = api.memory.save.useMutation();
  const forget = api.memory.forget.useMutation();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof z.infer<typeof editMemoryRecordSchema>, string>>
  >({});
  const [saved, setSaved] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [recordId] = useState(() => record?.id ?? crypto.randomUUID());
  const pending = save.isPending || forget.isPending;

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setFieldErrors({});
    setSaved(false);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = editMemoryRecordSchema.safeParse({
      id: recordId,
      expectedRevision: record?.revision ?? 0,
      kind: values.kind,
      title: values.title,
      body: values.body,
      aliases: z
        .string()
        .catch("")
        .parse(values.aliases)
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      const errors: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "title")
          errors.title = "Enter a title of 1–160 characters.";
        else if (field === "body")
          errors.body = "Enter a fact of 1–3,000 characters.";
        else if (field === "aliases")
          errors.aliases =
            "Use up to 12 terms, with at most 160 characters each.";
        else setError("Choose a category and check the fields below.");
      }
      setFieldErrors(errors);
      const invalid = event.currentTarget.elements.namedItem(
        parsed.error.issues[0]?.path[0]?.toString() ?? ""
      );
      if (invalid instanceof HTMLElement) invalid.focus();
      return;
    }
    try {
      await save.mutateAsync({ ...parsed.data, sessionId, operationId });
      await utils.memory.invalidate();
      setSaved(true);
      onSaved(recordId);
    } catch (cause) {
      setError(memoryEditError(cause, "save"));
    }
  };

  const erase = async () => {
    if (!record) return;
    setError(undefined);
    try {
      await forget.mutateAsync({
        sessionId,
        id: record.id,
        expectedRevision: record.revision,
        operationId: crypto.randomUUID(),
      });
      await Promise.all([
        utils.memory.read.reset(),
        utils.memory.history.reset(),
        utils.memory.export.reset(),
      ]);
      await utils.memory.invalidate();
      setConfirmForget(false);
      onForgotten?.();
    } catch (cause) {
      setError(memoryEditError(cause, "forget"));
      setConfirmForget(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-section-title">
          {record ? "Saved memory" : "Remember a fact"}
        </h2>
        {record ? (
          <Badge variant="secondary">{record.content.status}</Badge>
        ) : null}
      </div>
      <p className="type-supporting-body text-muted-foreground">
        Save facts and preferences you want reused. Keep passwords and payment
        details in Vault.
      </p>
      {error ? (
        <MemoryError message={error} title="Memory wasn't changed" />
      ) : null}
      <form
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          setOperationId(crypto.randomUUID());
          setFieldErrors({});
          setError(undefined);
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="memory-kind">Category</Label>
          <Select
            name="kind"
            defaultValue={record?.content.kind ?? "preference"}
            disabled={pending}
          >
            <SelectTrigger id="memory-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {memoryKindSchema.options.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind === "episode"
                    ? "Event"
                    : kind.charAt(0).toUpperCase() + kind.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="memory-title">Title</Label>
          <Input
            id="memory-title"
            name="title"
            required
            maxLength={160}
            defaultValue={record?.content.title ?? ""}
            disabled={pending}
            placeholder="Dining preferences"
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={
              fieldErrors.title ? "memory-title-error" : undefined
            }
          />
          {fieldErrors.title ? (
            <p
              id="memory-title-error"
              className="type-caption text-destructive"
            >
              {fieldErrors.title}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="memory-body">Fact</Label>
          <Textarea
            id="memory-body"
            name="body"
            required
            maxLength={3000}
            defaultValue={record?.content.body ?? ""}
            disabled={pending}
            placeholder="I prefer vegetarian restaurants."
            aria-invalid={Boolean(fieldErrors.body)}
            aria-describedby={
              fieldErrors.body ? "memory-body-error" : undefined
            }
          />
          {fieldErrors.body ? (
            <p id="memory-body-error" className="type-caption text-destructive">
              {fieldErrors.body}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="memory-aliases">Other names or search terms</Label>
          <Input
            id="memory-aliases"
            name="aliases"
            defaultValue={record?.content.aliases.join(", ") ?? ""}
            disabled={pending}
            placeholder="food, restaurants"
            aria-invalid={Boolean(fieldErrors.aliases)}
            aria-describedby={
              fieldErrors.aliases ? "memory-aliases-error" : undefined
            }
          />
          {fieldErrors.aliases ? (
            <p
              id="memory-aliases-error"
              className="type-caption text-destructive"
            >
              {fieldErrors.aliases}
            </p>
          ) : null}
          <p className="type-caption text-muted-foreground">
            Separate up to 12 terms with commas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {save.isPending
              ? "Saving…"
              : record
                ? "Save correction"
                : "Remember fact"}
          </Button>
          {!record && onCancel ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          {record ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setConfirmForget(true);
              }}
            >
              Forget memory
            </Button>
          ) : null}
          <output className="type-supporting-body text-muted-foreground">
            {saved ? "Saved." : null}
          </output>
        </div>
      </form>
      <Dialog
        open={confirmForget}
        onOpenChange={(open) => {
          if (!pending) setConfirmForget(open);
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Forget this memory?</DialogTitle>
            <DialogDescription>
              Its saved content, evidence, and revision history will be removed
              from memory. Related memories supported by the same source may
              also be removed. Your original chats remain. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setConfirmForget(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void erase()}
            >
              {forget.isPending ? "Forgetting…" : "Forget memory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemoryError({
  message,
  retry,
  title = "Memory unavailable",
}: {
  readonly message: string;
  readonly retry?: () => void;
  readonly title?: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {message}
        {retry ? (
          <Button type="button" variant="outline" onClick={retry}>
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function memoryEditError(cause: unknown, action: "save" | "forget") {
  if (cause instanceof Error) {
    if (cause.message.startsWith("This memory was forgotten.")) {
      return "This memory was forgotten in another page. Refresh, or choose Remember a fact to save a new one.";
    }
    if (cause.message.startsWith("Memory changed.")) {
      return "This memory changed in another page. Refresh to see the latest version before editing it.";
    }
    if (cause.message.startsWith("Credentials and excluded statements")) {
      return "Passwords, payment details and facts marked do not remember cannot be saved here.";
    }
  }
  return action === "save"
    ? "Couldn't save this memory. Your entered text is still here; try again."
    : "Couldn't confirm deletion. Refresh to check this memory before trying again.";
}

function dateLabel(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function memoryMarkdown(data: RouterOutputs["memory"]["export"]) {
  return [
    "# OpenInstinct memory",
    ...data.records.map((record) => {
      const content = record.content;
      return [
        `## ${content.title}`,
        "```yaml",
        `id: ${JSON.stringify(record.id)}`,
        `type: ${content.kind}`,
        `revision: ${String(record.revision)}`,
        `status: ${content.status}`,
        `aliases: ${JSON.stringify(content.aliases)}`,
        `effectiveAt: ${JSON.stringify(content.effectiveAt)}`,
        `expiresAt: ${JSON.stringify(content.expiresAt)}`,
        "```",
        content.body,
        ...data.links
          .filter((link) => link.fromId === record.id)
          .map((link) => `- ${link.relation}: [[${link.toId}]]`),
        "### Evidence",
        ...content.evidence.map((evidence) => {
          const source = data.sources.find(
            (item) => item.id === evidence.sourceId
          );
          return source?.text
            ? `${source.kind} · ${new Date(source.observedAt).toISOString()}\n\n${source.text
                .slice(evidence.start, evidence.end)
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}`
            : "Source unavailable.";
        }),
      ].join("\n\n");
    }),
  ].join("\n\n");
}
