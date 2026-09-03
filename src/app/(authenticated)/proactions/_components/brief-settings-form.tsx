"use client";

import { type SubmitEvent, useState } from "react";
import { z } from "zod";
import type { ProactionOverview } from "@/agent/lib/proactions/overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/client";

const briefSettingsFormSchema = z.object({
  briefLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  timezone: z.string().trim().min(1),
});

export function BriefSettingsForm({
  onSaved,
  settings,
}: {
  readonly onSaved: () => void;
  readonly settings: ProactionOverview["settings"];
}) {
  const update = api.proactions.updateSettings.useMutation();
  const [status, setStatus] = useState<"error" | "saved">();
  const browserTimezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(undefined);
    const parsed = briefSettingsFormSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget))
    );
    if (!parsed.success) {
      setStatus("error");
      return;
    }
    update.mutate(parsed.data, {
      onError: () => {
        setStatus("error");
      },
      onSuccess: () => {
        setStatus("saved");
        onSaved();
      },
    });
  };

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={submit}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="proactions-timezone">Timezone</Label>
        <Input
          defaultValue={settings.timezone}
          id="proactions-timezone"
          name="timezone"
          placeholder={browserTimezone}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proactions-brief-time">Brief time</Label>
        <Input
          defaultValue={settings.briefLocalTime}
          id="proactions-brief-time"
          name="briefLocalTime"
          required
          type="time"
        />
      </div>
      <Button disabled={update.isPending} type="submit" variant="outline">
        {update.isPending ? "Saving" : "Save"}
      </Button>
      {status === "saved" ? (
        <output className="type-caption text-muted-foreground">Saved.</output>
      ) : status === "error" ? (
        <p className="type-caption text-destructive" role="alert">
          Use a valid timezone and a 24-hour time.
        </p>
      ) : null}
    </form>
  );
}
