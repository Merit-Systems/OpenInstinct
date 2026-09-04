import { defineProaction } from "../define";

export default defineProaction({
  cadence: { kind: "weekly", weekday: 1 },
  cooldownHours: 24 * 30,
  defaults: { autonomy: "notify", enabled: true },
  description:
    "Weekly, checks whether your internet, phone, or other recurring bills have a cheaper like-for-like plan.",
  id: "bill-savings",
  maxAutonomy: "propose",
  requires: ["google"],
  title: "Bill savings",
});
