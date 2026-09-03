import { describe, expect, it } from "vitest";
import { parseAdminPolicy } from "@/agent/lib/proactions/admin";
import { defineProaction } from "@/agent/lib/proactions/define";
import { effectiveProactionPolicy } from "@/agent/lib/proactions/policy";

const watch = defineProaction({
  act: true,
  cadence: { everyMinutes: 360, kind: "interval" },
  cooldownHours: 72,
  defaults: { autonomy: "propose", enabled: true },
  description: "Watches fares.",
  id: "flight-price-watch",
  maxAutonomy: "auto",
  requires: ["google", "browser"],
  title: "Flight price watch",
});

const nudge = defineProaction({
  cadence: { kind: "weekly", weekday: 5 },
  cooldownHours: 24 * 30,
  defaults: { autonomy: "notify", enabled: true },
  description: "Card nudges.",
  id: "card-rewards-nudge",
  maxAutonomy: "notify",
  requires: ["google", "paymentCard"],
  title: "Card rewards nudge",
});

describe("effective proaction policy", () => {
  it("uses the author defaults when nobody has overridden them", () => {
    const policy = effectiveProactionPolicy(
      watch,
      parseAdminPolicy(undefined),
      undefined
    );
    expect(policy).toMatchObject({
      adminDisabled: false,
      autonomy: "propose",
      autonomyCeiling: "auto",
      enabled: true,
    });
  });

  it("lets the user raise autonomy up to the ceiling and turn it off", () => {
    const raised = effectiveProactionPolicy(
      watch,
      parseAdminPolicy(undefined),
      {
        autonomy: "auto",
        enabled: null,
      }
    );
    expect(raised.autonomy).toBe("auto");
    const off = effectiveProactionPolicy(watch, parseAdminPolicy(undefined), {
      autonomy: null,
      enabled: false,
    });
    expect(off.enabled).toBe(false);
  });

  it("clamps the user's choice to the deployment ceiling", () => {
    const admin = parseAdminPolicy(
      JSON.stringify({
        maxAutonomy: "propose",
        overrides: { "flight-price-watch": { maxAutonomy: "notify" } },
      })
    );
    const policy = effectiveProactionPolicy(watch, admin, {
      autonomy: "auto",
      enabled: true,
    });
    expect(policy.autonomy).toBe("notify");
    expect(policy.autonomyCeiling).toBe("notify");
  });

  it("never exceeds the author ceiling even when the deployment allows more", () => {
    const policy = effectiveProactionPolicy(
      nudge,
      parseAdminPolicy(undefined),
      {
        autonomy: "auto",
        enabled: null,
      }
    );
    expect(policy.autonomy).toBe("notify");
  });

  it("lets the deployment disable a proaction regardless of the user", () => {
    const admin = parseAdminPolicy(
      JSON.stringify({ disabled: ["card-rewards-nudge"] })
    );
    const policy = effectiveProactionPolicy(nudge, admin, {
      autonomy: null,
      enabled: true,
    });
    expect(policy).toMatchObject({ adminDisabled: true, enabled: false });
  });

  it("rejects a definition that defaults above its own ceiling or automates without an act procedure", () => {
    expect(() =>
      defineProaction({
        ...nudge,
        defaults: { autonomy: "propose", enabled: true },
      })
    ).toThrow(/higher autonomy/u);
    expect(() => defineProaction({ ...watch, act: undefined })).toThrow(
      /act procedure/u
    );
  });
});
