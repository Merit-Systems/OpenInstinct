import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { z } from "zod";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { getEnv } from "@/lib/runtime-env";

export const { auth, handlers, signIn } = NextAuth({
  callbacks: {
    authorized({ auth: session, request }) {
      if (getDeploymentMode() === "local") return true;

      const pathname = request.nextUrl.pathname;
      if (
        pathname === "/sign-in" ||
        pathname.startsWith("/api/auth/") ||
        pathname === "/eve/v1/health"
      ) {
        return true;
      }

      return Boolean(session?.user.id);
    },
    jwt({ account, token }) {
      if (account) {
        token.appUserId = `${account.provider}:${account.providerAccountId}`;
      }
      return token;
    },
    session({ session, token }) {
      const userId = z.string().min(1).safeParse(token.appUserId);
      if (userId.success) session.user.id = userId.data;
      return session;
    },
  },
  pages: { signIn: "/sign-in" },
  providers: [GitHub],
  secret:
    getEnv().AUTH_SECRET ??
    (getDeploymentMode() === "local"
      ? "local-vault-assistant-local-only-auth-secret"
      : undefined),
  session: { strategy: "jwt" },
});
