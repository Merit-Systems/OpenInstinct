import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      aria-label="Loading tasks"
      className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:py-8"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
