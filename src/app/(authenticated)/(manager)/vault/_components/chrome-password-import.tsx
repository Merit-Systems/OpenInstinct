"use client";

import {
  ExternalLinkIcon,
  FileKeyIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagerMutation } from "@/modules/manager";
import { parseChromePasswordsCsv } from "@/modules/manager/chrome-passwords";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const GOOGLE_PASSWORD_MANAGER_URL = "https://passwords.google.com/options";

export function ChromePasswordImportPanel({
  busy,
  onDone,
  onImport,
}: {
  readonly busy: boolean;
  readonly onDone: () => void;
  readonly onImport: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [selection, setSelection] =
    useState<ReturnType<typeof parseChromePasswordsCsv>>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string>();
  const [importedCount, setImportedCount] = useState<number>();
  const [inputKey, setInputKey] = useState(0);

  const chooseFile = async (file?: File) => {
    setError(undefined);
    setImportedCount(undefined);
    setSelection(undefined);
    setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("Choose a CSV smaller than 10 MB.");
      return;
    }

    try {
      setSelection(parseChromePasswordsCsv(await file.text()));
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "That CSV could not be read."
      );
    }
  };

  const importPasswords = async () => {
    if (!selection) return;
    setError(undefined);
    const count = selection.items.length;
    const saved = await onImport({
      action: "vault.import",
      items: selection.items,
    });
    if (!saved) {
      setError(
        "The import did not finish. Check the vault error and try again."
      );
      return;
    }

    setSelection(undefined);
    setImportedCount(count);
    setFileName("");
    setInputKey((key) => key + 1);
  };

  const reset = () => {
    setSelection(undefined);
    setFileName("");
    setError(undefined);
    setImportedCount(undefined);
    setInputKey((key) => key + 1);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import Chrome passwords</DialogTitle>
        <DialogDescription>
          Export a CSV from Google Password Manager, then choose it here. The
          passwords go into this workspace&apos;s encrypted vault.
        </DialogDescription>
      </DialogHeader>

      {importedCount === undefined ? (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <p className="type-label">1. Export your passwords</p>
            <p className="type-supporting-body text-muted-foreground">
              Open Settings in Google Password Manager and choose Export
              passwords.
            </p>
            <Button
              className="w-fit"
              nativeButton={false}
              render={
                <a
                  href={GOOGLE_PASSWORD_MANAGER_URL}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              variant="outline"
            >
              Open Google Password Manager
              <ExternalLinkIcon />
            </Button>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="chrome-passwords-csv">
              2. Choose the exported CSV
            </Label>
            <Input
              accept=".csv,text/csv"
              disabled={busy}
              id="chrome-passwords-csv"
              key={inputKey}
              onChange={(event) =>
                void chooseFile(event.currentTarget.files?.[0])
              }
              type="file"
            />
            {selection ? (
              <p className="type-supporting-body text-muted-foreground">
                {selection.items.length.toLocaleString()} login
                {selection.items.length === 1 ? "" : "s"} ready from {fileName}
                {selection.skipped > 0
                  ? ` · ${selection.skipped.toLocaleString()} invalid ${selection.skipped === 1 ? "row" : "rows"} skipped`
                  : ""}
              </p>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <FileKeyIcon />
              <AlertTitle>Couldn&apos;t import this file</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Alert>
            <ShieldCheckIcon />
            <AlertTitle>Your passwords stay in your vault</AlertTitle>
            <AlertDescription>
              The CSV is read in this browser and is not copied to Kernel.
              Chrome exports passwords as plain text, so delete the file after
              this import.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>
            {importedCount.toLocaleString()} login
            {importedCount === 1 ? "" : "s"} imported
          </AlertTitle>
          <AlertDescription>
            They are now available to the agent through the encrypted vault.
            Delete the exported CSV from your device.
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        {importedCount === undefined ? (
          <Button
            disabled={busy || !selection}
            onClick={() => void importPasswords()}
            type="button"
          >
            <UploadIcon />
            {busy
              ? "Importing…"
              : selection
                ? `Import ${selection.items.length.toLocaleString()} ${selection.items.length === 1 ? "login" : "logins"}`
                : "Choose a CSV"}
          </Button>
        ) : (
          <Button
            onClick={() => {
              reset();
              onDone();
            }}
            type="button"
          >
            Done
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
