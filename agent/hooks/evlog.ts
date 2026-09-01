import { defineEvlogHook } from "evlog/eve";

export default defineEvlogHook({
  init: {
    env: { service: "open-instinct" },
    redact: false,
  },
  message: "full",
  redact: false,
  sessionEvent: true,
});
