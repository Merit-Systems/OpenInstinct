"use client";

import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AccountControl() {
  const { data: session } = authClient.useSession();
  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-3">
      <span className="min-w-0 flex-1 truncate type-label text-muted-foreground">
        {maskPhoneNumber(session.user.phoneNumber)}
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

function maskPhoneNumber(phoneNumber: string | null | undefined) {
  if (!phoneNumber) return "Signed in";
  return `Phone ending in ${phoneNumber.slice(-4)}`;
}

function clearWorkspaceBrowserData() {
  const workspaceId = document.body.dataset.workspaceId;
  if (!workspaceId) return;
  window.localStorage.removeItem(
    `local-vault-assistant:browser-runs:v2:${workspaceId}`
  );
}
