"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/app/_lib/auth-client";
import { browserRunStoreKeyForWorkspace } from "@/app/(authenticated)/_lib/browser-run-store";

export function AuthenticatedAccountControl() {
  const { data: session } = authClient.useSession();
  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-3">
      <UserIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate type-label text-muted-foreground">
        {session.user.phoneNumber ?? "Signed in"}
      </span>
      <Button
        aria-label="Sign out"
        onClick={() => {
          clearWorkspaceBrowserData();
          void authClient.signOut().finally(() => {
            window.location.assign("/sign-in");
          });
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
  window.localStorage.removeItem(browserRunStoreKeyForWorkspace(workspaceId));
}
