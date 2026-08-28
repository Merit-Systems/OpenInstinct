"use client";

import { Button } from "@/components/ui/button";
import type { ManagerSnapshot } from "@/lib/manager";
import { api } from "@/trpc/client";

export function GoogleWorkspaceAction({
  state,
}: {
  readonly state?: ManagerSnapshot["googleWorkspace"]["state"];
}) {
  const update = api.googleWorkspace.update.useMutation({
    onError: () => window.location.assign("/?google=unavailable"),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  if (!state) {
    return <span className="type-caption text-muted-foreground">Loading…</span>;
  }
  if (state === "unavailable") {
    return (
      <span className="type-caption text-muted-foreground">Setup required</span>
    );
  }

  const action = state === "connected" ? "disconnect" : "connect";
  return (
    <Button
      disabled={update.isPending}
      onClick={() => update.mutate(action)}
      size="sm"
      type="button"
      variant="outline"
    >
      {state === "connected" ? "Disconnect" : "Connect"}
    </Button>
  );
}
