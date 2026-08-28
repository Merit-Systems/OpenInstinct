import { notFound } from "next/navigation";
import { DebugCheckout } from "@/app/_components/debug-checkout";
import { getEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function DebugCheckoutPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly variant?: string }>;
}) {
  if (getEnv().NODE_ENV !== "development") notFound();

  const variant = checkoutVariant((await searchParams).variant);
  return <DebugCheckout variant={variant} />;
}

function checkoutVariant(value: string | undefined) {
  if (value === "heuristic" || value === "iframe") return value;
  return "standard";
}
