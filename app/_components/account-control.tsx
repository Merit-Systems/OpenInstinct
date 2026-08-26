"use client";

import { LogOutIcon } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AccountControl() {
  const { data: session } = useSession();
  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-3">
      <span className="min-w-0 flex-1 truncate type-label text-muted-foreground">
        {session.user.email ?? session.user.name ?? "Signed in"}
      </span>
      <Button
        aria-label="Sign out"
        onClick={() => {
          clearWorkspaceBrowserData();
          void signOut({ redirectTo: "/sign-in" });
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <LogOutIcon />
      </Button>
    </div>
  );
}

function clearWorkspaceBrowserData() {
  const workspaceId = document.body.dataset.workspaceId;
  if (!workspaceId) return;
  window.localStorage.removeItem(
    `local-vault-assistant:browser-runs:v2:${workspaceId}`
  );
}
