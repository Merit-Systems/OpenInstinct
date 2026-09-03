import { defineProaction } from "../define";

export default defineProaction({
  cadence: { kind: "weekly", weekday: 5 },
  cooldownHours: 24 * 30,
  defaults: { autonomy: "notify", enabled: true },
  description:
    "Compares recent receipts with your saved cards and nudges you when a different card would earn more.",
  id: "card-rewards-nudge",
  maxAutonomy: "notify",
  requires: ["google", "paymentCard"],
  title: "Card rewards nudge",
});
