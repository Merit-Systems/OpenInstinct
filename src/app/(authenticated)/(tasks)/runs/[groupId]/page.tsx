import { BrowserRunDetail } from "./_components/browser-run-detail";

export default async function BrowserRunPage({
  params,
}: PageProps<"/runs/[groupId]">) {
  const { groupId } = await params;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
      <BrowserRunDetail groupId={groupId} />
    </div>
  );
}
