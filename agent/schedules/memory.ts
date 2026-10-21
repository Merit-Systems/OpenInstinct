import { defineSchedule } from "eve/schedules";
import { maintainKnowledge } from "@agent/lib/memory/maintenance";

export default defineSchedule({
  cron: "* * * * *",
  run({ waitUntil }) {
    waitUntil(maintainKnowledge());
  },
});
