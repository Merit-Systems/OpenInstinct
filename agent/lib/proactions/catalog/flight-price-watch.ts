import { defineProaction } from "../define";

export default defineProaction({
  act: true,
  cadence: { everyMinutes: 360, kind: "interval" },
  cooldownHours: 72,
  defaults: { autonomy: "propose", enabled: true },
  description:
    "Watches fares on flights you already booked and rebooks the same itinerary for a credit when the price drops.",
  id: "flight-price-watch",
  maxAutonomy: "auto",
  requires: ["google", "browser"],
  title: "Flight price watch",
});
