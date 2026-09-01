import { defineEvlogInstrumentation } from "evlog/eve";

export default defineEvlogInstrumentation({
  recordInputs: true,
  recordOutputs: true,
  traceChannelRequests: true,
});
