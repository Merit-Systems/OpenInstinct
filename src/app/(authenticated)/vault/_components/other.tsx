"use client";

import type { VaultItem } from "@/lib/vault";
import { VaultItemList } from "./section";

export function VaultOtherItems({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="other-vault-heading" className="space-y-3">
      <h2
        className="type-caption text-muted-foreground uppercase"
        id="other-vault-heading"
      >
        Other
      </h2>
      <div className="border-y border-border/50">
        <VaultItemList items={items} />
      </div>
    </section>
  );
}
