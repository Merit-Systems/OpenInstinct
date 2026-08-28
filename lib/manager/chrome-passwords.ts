import type { ManagerMutation } from ".";
import {
  loginIdentifierSchema,
  serializeLoginVaultPayload,
} from "./vault-payload";

const MAX_IMPORT_ITEMS = 3_000;
const MAX_ACCOUNT_LENGTH = 300;
const MAX_LABEL_LENGTH = 120;
const MAX_SECRET_LENGTH = 20_000;

type VaultImportItem = Extract<
  ManagerMutation,
  { action: "vault.import" }
>["items"][number];

export function parseChromePasswordsCsv(csv: string) {
  const rows = parseCsv(csv);
  const headers = rows.shift()?.map((header) =>
    header
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
  );
  if (!headers) throw new Error("Choose a Chrome passwords CSV file.");

  const indexes = {
    name: headers.indexOf("name"),
    password: headers.indexOf("password"),
    url: headers.indexOf("url"),
    username: headers.indexOf("username"),
  };
  if (indexes.url < 0 || indexes.username < 0 || indexes.password < 0) {
    throw new Error(
      "This CSV needs url, username, and password columns. Export it from Google Password Manager and try again."
    );
  }

  const items: VaultImportItem[] = [];
  let skipped = 0;

  for (const row of rows) {
    if (row.every((value) => value.length === 0)) continue;

    const account = row[indexes.username]?.trim() ?? "";
    const password = row[indexes.password] ?? "";
    const url = row[indexes.url]?.trim() ?? "";
    const origin = originFromUrl(url);
    const name = indexes.name >= 0 ? row[indexes.name]?.trim() : undefined;
    const label = name?.length ? name : labelFromUrl(url);

    if (
      !label ||
      !origin ||
      account.length === 0 ||
      password.length === 0 ||
      account.length > MAX_ACCOUNT_LENGTH ||
      label.length > MAX_LABEL_LENGTH ||
      password.length > MAX_SECRET_LENGTH
    ) {
      skipped += 1;
      continue;
    }

    items.push({
      account: "",
      kind: "login",
      label,
      secret: serializeLoginVaultPayload({
        authentication: { password, type: "password" },
        identifier: {
          type: loginIdentifierSchema.safeParse({
            type: "email",
            value: account,
          }).success
            ? "email"
            : "username",
          value: account,
        },
        kind: "login",
        origin,
        version: 2,
      }),
    });
  }

  if (items.length === 0) {
    throw new Error("No valid saved passwords were found in this CSV.");
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    throw new Error(
      `This file contains ${items.length.toLocaleString()} passwords. Import up to ${MAX_IMPORT_ITEMS.toLocaleString()} at a time.`
    );
  }

  return { items, skipped };
}

function labelFromUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || value;
  } catch {
    return value.slice(0, MAX_LABEL_LENGTH);
  }
}

function originFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let field = "";
  let quoted = false;
  let row: string[] = [];

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv.charAt(index);
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("This CSV has an unfinished quoted value.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
