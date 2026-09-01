import { z } from "zod";

const weekdaySchema = z.enum([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

const localTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Use 24-hour HH:MM format.");

export const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    at: z.iso.datetime({ offset: true }),
    kind: z.literal("at"),
  }),
  z
    .object({
      kind: z.literal("recurring"),
      localTime: localTimeSchema,
      recurrence: z.enum(["daily", "weekdays", "weekly"]),
      weekday: weekdaySchema.optional(),
    })
    .refine((trigger) => trigger.recurrence !== "weekly" || trigger.weekday, {
      message: "Weekly automations require a weekday.",
      path: ["weekday"],
    }),
  z.object({
    everyMinutes: z.number().int().min(5).max(525_600),
    kind: z.literal("interval"),
    startsAt: z.iso.datetime({ offset: true }).optional(),
  }),
  z
    .object({
      fromAddress: z.email().optional(),
      kind: z.literal("gmail"),
      subjectContains: z.string().min(1).max(500).optional(),
      threadId: z.string().min(1).max(200).optional(),
    })
    .refine(
      (trigger) =>
        trigger.fromAddress !== undefined ||
        trigger.subjectContains !== undefined ||
        trigger.threadId !== undefined,
      { message: "A Gmail automation needs at least one message filter." }
    ),
]);

export const automationStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "deleted",
]);

export const automationSchema = z.object({
  createdAt: z.string(),
  createdByUserId: z.string().min(1),
  id: z.string().min(1),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  phoneNumber: z.string().min(1),
  revision: z.number().int().positive(),
  sessionId: z.string().min(1),
  status: automationStatusSchema,
  task: z.string().min(1),
  timezone: z.string().min(1),
  title: z.string().min(1),
  trigger: automationTriggerSchema,
  updatedAt: z.string(),
  workspaceId: z.string().min(1),
});

export type Automation = z.infer<typeof automationSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

const weekdayNumbers = new Map(
  weekdaySchema.options.map((weekday, index) => [weekday, index])
);

export function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Unknown IANA timezone: ${timezone}`);
  }
}

export function nextAutomationRunAt(
  trigger: AutomationTrigger,
  timezone: string,
  after: Date
) {
  if (trigger.kind === "gmail") return undefined;
  if (trigger.kind === "at") {
    const at = new Date(trigger.at);
    return at.getTime() > after.getTime() ? at : undefined;
  }
  if (trigger.kind === "interval") {
    const intervalMilliseconds = trigger.everyMinutes * 60_000;
    const startsAt = trigger.startsAt ? new Date(trigger.startsAt) : after;
    if (startsAt.getTime() > after.getTime()) return startsAt;
    const elapsed = after.getTime() - startsAt.getTime();
    return new Date(
      startsAt.getTime() +
        (Math.floor(elapsed / intervalMilliseconds) + 1) * intervalMilliseconds
    );
  }

  assertTimezone(timezone);
  if (trigger.recurrence === "weekly" && trigger.weekday === undefined) {
    throw new Error("Weekly automations require a weekday.");
  }

  const [hour, minute] = trigger.localTime.split(":").map(Number);
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
  });
  const afterParts = localDateParts(formatter, after);
  const afterDate = localDateKey(afterParts);
  let currentDateAlreadyRan = false;
  for (let offset = 0; offset <= 26 * 60; offset += 1) {
    const candidate = new Date(after.getTime() - offset * 60_000);
    const parts = localDateParts(formatter, candidate);
    if (localDateKey(parts) !== afterDate) continue;
    if (Number(parts.hour) % 24 === hour && Number(parts.minute) === minute) {
      currentDateAlreadyRan = true;
      break;
    }
  }
  const firstCandidate = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const maximumMinutes = 8 * 24 * 60;

  for (let offset = 0; offset < maximumMinutes; offset += 1) {
    const candidate = new Date(firstCandidate + offset * 60_000);
    const parts = localDateParts(formatter, candidate);
    const candidateHour = Number(parts.hour) % 24;
    if (candidateHour !== hour || Number(parts.minute) !== minute) continue;
    if (currentDateAlreadyRan && localDateKey(parts) === afterDate) continue;

    const candidateWeekday = weekdayNumbers.get(
      weekdaySchema.parse(parts.weekday)
    );
    const targetWeekday =
      trigger.weekday === undefined
        ? undefined
        : weekdayNumbers.get(trigger.weekday);
    const allowed =
      trigger.recurrence === "daily" ||
      (trigger.recurrence === "weekdays" &&
        candidateWeekday !== 0 &&
        candidateWeekday !== 6) ||
      (trigger.recurrence === "weekly" && candidateWeekday === targetWeekday);
    if (allowed) return candidate;
  }

  throw new Error(`Could not resolve the next run in ${timezone}.`);
}

function localDateParts(formatter: Intl.DateTimeFormat, date: Date) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value.toLowerCase()])
  );
}

function localDateKey(parts: Record<string, string>) {
  const date = z
    .object({ day: z.string(), month: z.string(), year: z.string() })
    .parse(parts);
  return `${date.year}-${date.month}-${date.day}`;
}

export function gmailTriggerMatches(
  trigger: Extract<AutomationTrigger, { kind: "gmail" }>,
  message: {
    readonly from: string;
    readonly subject: string;
    readonly threadId: string;
  }
) {
  if (
    trigger.fromAddress &&
    fromMailbox(message.from) !== trigger.fromAddress.toLowerCase()
  ) {
    return false;
  }
  if (trigger.threadId && message.threadId !== trigger.threadId) return false;
  if (
    trigger.subjectContains &&
    !message.subject
      .toLowerCase()
      .includes(trigger.subjectContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function fromMailbox(header: string) {
  const bracketed = /<\s*([^<>]+?)\s*>/u.exec(header)?.[1];
  return (bracketed ?? header).trim().toLowerCase();
}
