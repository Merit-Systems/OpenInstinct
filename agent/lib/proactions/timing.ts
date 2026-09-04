import type { ScheduleTiming } from "@/agent/lib/schedules/timing";
import type { ProactionCadence } from "./define";

export interface ProactionTimingSettings {
  readonly briefLocalTime: string;
  readonly timezone: string;
}

export function proactionTiming(
  cadence: ProactionCadence,
  settings: ProactionTimingSettings,
  now: Date
): ScheduleTiming {
  if (cadence.kind === "interval") {
    return {
      anchoredAt: now.toISOString(),
      everyMinutes: cadence.everyMinutes,
      kind: "interval",
    };
  }
  if (cadence.kind === "weekly") {
    return {
      frequency: "weekly",
      kind: "calendar",
      localTime: settings.briefLocalTime,
      timezone: settings.timezone,
      weekday: cadence.weekday,
    };
  }
  return {
    frequency: "daily",
    kind: "calendar",
    localTime: settings.briefLocalTime,
    timezone: settings.timezone,
  };
}

const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function describeCadence(cadence: ProactionCadence) {
  if (cadence.kind === "interval") {
    return cadence.everyMinutes % 60 === 0
      ? `Every ${String(cadence.everyMinutes / 60)} hours`
      : `Every ${String(cadence.everyMinutes)} minutes`;
  }
  if (cadence.kind === "weekly") {
    return `Weekly on ${weekdayNames[cadence.weekday] ?? "Monday"} at your brief time`;
  }
  return "Daily at your brief time";
}
