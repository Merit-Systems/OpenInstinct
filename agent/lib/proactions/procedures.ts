import { proactions } from "./catalog";
import billSavings from "@/agent/instructions/content/proactions/bill-savings.md?raw";
import cardRewardsNudge from "@/agent/instructions/content/proactions/card-rewards-nudge.md?raw";
import flightPriceWatchAct from "@/agent/instructions/content/proactions/flight-price-watch.act.md?raw";
import flightPriceWatch from "@/agent/instructions/content/proactions/flight-price-watch.md?raw";
import tomorrowBrief from "@/agent/instructions/content/proactions/tomorrow-brief.md?raw";

export interface ProactionProcedure {
  readonly act?: string;
  readonly observe: string;
}

// The model-facing half of each catalog entry. Kept apart from the metadata
// so only the agent bundle carries the markdown.
const procedures = new Map<string, ProactionProcedure>([
  ["bill-savings", { observe: billSavings }],
  ["card-rewards-nudge", { observe: cardRewardsNudge }],
  [
    "flight-price-watch",
    { act: flightPriceWatchAct, observe: flightPriceWatch },
  ],
  ["tomorrow-brief", { observe: tomorrowBrief }],
]);

for (const definition of proactions) {
  const procedure = procedures.get(definition.id);
  if (!procedure) {
    throw new Error(`Proaction ${definition.id} has no observe procedure.`);
  }
  if (definition.act && !procedure.act) {
    throw new Error(
      `Proaction ${definition.id} allows auto but has no act procedure.`
    );
  }
}

export function proactionProcedure(id: string): ProactionProcedure {
  const procedure = procedures.get(id);
  if (!procedure) throw new Error(`Unknown proaction: ${id}`);
  return procedure;
}
