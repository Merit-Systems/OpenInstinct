"use client";

import { Button } from "@/components/ui/button";

export default function TasksError({ reset }: { readonly reset: () => void }) {
  return (
    <div className="mx-auto grid min-h-48 w-full max-w-3xl place-content-center gap-4 px-4 py-6 text-center sm:py-8">
      <div>
        <h1 className="type-card-title">Traces unavailable</h1>
        <p className="type-supporting-body mt-1 text-muted-foreground">
          The browser trace history could not be loaded.
        </p>
      </div>
      <Button onClick={reset} type="button" variant="outline">
        Try again
      </Button>
    </div>
  );
}
