import { proactionOverview } from "@/agent/lib/proactions/overview";
import { requireRequestScope } from "@/lib/request-scope";
import { ProactionsView } from "./_components/proactions-view";

export default async function Page() {
  const scope = await requireRequestScope();
  return <ProactionsView initialOverview={await proactionOverview(scope)} />;
}
