"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import type { Session } from "next-auth";

export function AuthProvider({
  children,
  session,
}: {
  readonly children: ReactNode;
  readonly session: Session | null;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
