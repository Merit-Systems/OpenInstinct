import { notFound } from "next/navigation";
import { DebugCardFields } from "@/app/_components/debug-checkout";
import { getEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default function DebugCardFramePage() {
  if (getEnv().NODE_ENV !== "development") notFound();

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground">
      <DebugCardFields framed />
    </main>
  );
}
