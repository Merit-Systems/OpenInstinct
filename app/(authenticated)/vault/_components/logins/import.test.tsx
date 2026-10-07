import type * as React from "react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { z } from "zod";
import {
  parseLoginVaultPayload,
  vaultImportItemsSchema,
} from "@shared/vault/schema";
import type { Input } from "@web/components/ui/input";

type StateDispatch = ReturnType<typeof React.useState>[1];

interface Mocks {
  change: ComponentProps<typeof Input>["onChange"];
  dispatches: Mock<StateDispatch>[];
}

const mocks = vi.hoisted<Mocks>(() => ({
  change: undefined,
  dispatches: [],
}));

function DialogPart({ children }: { children: ReactNode }) {
  return children;
}

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const dispatch = vi.fn<StateDispatch>();
      mocks.dispatches.push(dispatch);
      return [initial, dispatch];
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn<() => void>() }),
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    vault: { import: { useMutation: () => ({ reset: vi.fn<() => void>() }) } },
  },
}));
vi.mock("@web/components/ui/input", () => ({
  Input: ({ onChange }: ComponentProps<typeof Input>) => {
    mocks.change = onChange;
    return <input type="file" />;
  },
}));
vi.mock("@web/components/ui/dialog", () => {
  return {
    DialogDescription: DialogPart,
    DialogFooter: DialogPart,
    DialogHeader: DialogPart,
    DialogTitle: DialogPart,
  };
});

import { ChromeImportPanel } from "./import";

function choose(file?: File) {
  const event = { currentTarget: { files: file ? [file] : [] } };
  mocks.change?.(
    // SAFETY: the change handler reads only currentTarget.files, supplied here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal event fixture
    event as typeof event & Parameters<NonNullable<typeof mocks.change>>[0]
  );
}

function csv(account: string) {
  return `name,url,username,password,note\nExample,https://example.com/,${account},sample-password,\n`;
}

function pendingFile(name: string) {
  const file = new File([], name, { type: "text/csv" });
  const read = Promise.withResolvers<string>();
  vi.spyOn(file, "text").mockReturnValue(read.promise);
  return { file, read };
}

function selectedIdentifier() {
  const selection = z
    .object({ items: vaultImportItemsSchema })
    .safeParse(mocks.dispatches[0]?.mock.lastCall?.[0]).data;
  return selection
    ? parseLoginVaultPayload(selection.items[0]?.secret ?? "")?.identifier.value
    : undefined;
}

describe("Chrome password file selection", () => {
  beforeEach(() => {
    mocks.dispatches = [];
    mocks.change = undefined;
    renderToStaticMarkup(<ChromeImportPanel onDone={vi.fn<() => void>()} />);
  });

  it("keeps the latest CSV when an older file finishes reading last", async () => {
    const older = pendingFile("older.csv");
    const latest = pendingFile("latest.csv");
    choose(older.file);
    choose(latest.file);
    latest.read.resolve(csv("latest@example.com"));
    await vi.waitFor(() => {
      expect(selectedIdentifier()).toBe("latest@example.com");
    });
    older.read.resolve(csv("older@example.com"));
    await older.read.promise;
    await Promise.resolve();
    expect(selectedIdentifier()).toBe("latest@example.com");
  });

  it("does not restore a file after the selection is cleared", async () => {
    const older = pendingFile("older.csv");
    choose(older.file);
    choose();
    older.read.resolve(csv("older@example.com"));
    await older.read.promise;
    await Promise.resolve();
    expect(selectedIdentifier()).toBeUndefined();
  });

  it("ignores a stale read error after a newer CSV succeeds", async () => {
    const older = pendingFile("older.csv");
    const latest = pendingFile("latest.csv");
    choose(older.file);
    choose(latest.file);
    latest.read.resolve(csv("latest@example.com"));
    await vi.waitFor(() => {
      expect(selectedIdentifier()).toBe("latest@example.com");
    });
    older.read.reject(new Error("The earlier file could not be read."));
    await older.read.promise.catch(() => undefined);
    await Promise.resolve();
    expect(mocks.dispatches[2]?.mock.lastCall?.[0]).toBeUndefined();
  });

  it("reads a single normal CSV and preserves its password", async () => {
    const current = pendingFile("current.csv");
    choose(current.file);
    current.read.resolve(csv("current@example.com"));
    await vi.waitFor(() => {
      expect(selectedIdentifier()).toBe("current@example.com");
    });
    const selection = z
      .object({ items: vaultImportItemsSchema })
      .parse(mocks.dispatches[0]?.mock.lastCall?.[0]);
    expect(
      parseLoginVaultPayload(selection.items[0]?.secret ?? "")?.authentication
    ).toEqual({
      password: "sample-password",
      type: "password",
    });
  });
});
