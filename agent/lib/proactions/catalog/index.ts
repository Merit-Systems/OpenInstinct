import type { ProactionDefinition } from "../define";
import billSavings from "./bill-savings";
import cardRewardsNudge from "./card-rewards-nudge";
import flightPriceWatch from "./flight-price-watch";
import tomorrowBrief from "./tomorrow-brief";

// Every proaction the deployment ships. Order is the order shown to users.
export const proactions: readonly ProactionDefinition[] = [
  tomorrowBrief,
  flightPriceWatch,
  billSavings,
  cardRewardsNudge,
];

const byId = new Map(proactions.map((proaction) => [proaction.id, proaction]));
if (byId.size !== proactions.length) {
  throw new Error("Proaction ids must be unique.");
}

export function proactionById(id: string) {
  return byId.get(id);
}
