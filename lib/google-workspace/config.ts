import type { ConnectTokenParams, ConnectTokenSubject } from "@vercel/connect";
import { z } from "zod";
import { env } from "@/lib/env";

export const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/contacts.readonly",
] as const;

export const GOOGLE_WORKSPACE_CONNECTOR =
  env.GOOGLE_CONNECTOR_UID ?? "google/open-instinct";

export const googleWorkspaceActionSchema = z.enum(["connect", "disconnect"]);

export function googleWorkspaceSubject(userId: string): ConnectTokenSubject {
  return { id: userId, issuer: "openinstinct", type: "user" };
}

export function googleWorkspaceTokenParams(userId: string): ConnectTokenParams {
  return {
    scopes: [...GOOGLE_WORKSPACE_SCOPES],
    subject: googleWorkspaceSubject(userId),
  };
}
