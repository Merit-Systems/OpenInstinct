import { defineProaction } from "../define";

export default defineProaction({
  cadence: { kind: "brief" },
  cooldownHours: 20,
  defaults: { autonomy: "propose", enabled: true },
  description:
    "Each morning, one heads-up about tomorrow: weather that collides with a plan, a delivery, a due date. Offers a ride when it helps.",
  id: "tomorrow-brief",
  maxAutonomy: "propose",
  requires: ["google"],
  title: "Tomorrow brief",
});
