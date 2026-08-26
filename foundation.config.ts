import { defineConfig } from "@merit-systems/foundation";

export default defineConfig({
  schemaVersion: 1,
  profiles: ["base", "next", "ui", "service"],
  ui: {
    sourceIntegrity: {
      deviations: [
        {
          item: "conversation",
          owner: "eve-kernel",
          reason:
            "Preserves per-session scroll position while durable Eve chat streams reconnect.",
        },
        {
          item: "hover-card",
          owner: "eve-kernel",
          reason:
            "Keeps the HoverCard compatibility API on the repository's Base UI primitive after removing the Radix runtime.",
        },
        {
          item: "prompt-input",
          owner: "eve-kernel",
          reason:
            "Provides the compact local chat composer and Base UI event compatibility required by the manager shell.",
        },
      ],
    },
  },
  units: [],
});
