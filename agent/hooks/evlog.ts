import { defineEvlogHook } from "evlog/eve";

export default defineEvlogHook({
  init: {
    env: { service: "open-instinct" },
    // Fork decision: production tenants' message content stays out of logs.
    redact: true,
  },
  message: "omit",
  redact: true,
  sessionEvent: true,
});
