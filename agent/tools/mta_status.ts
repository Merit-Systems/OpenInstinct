import { defineTool } from "eve/tools";
import { z } from "zod";

const feeds = {
  bus: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts.json",
  subway:
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json",
} as const;

const periodSchema = z.object({
  end: z.number().optional(),
  start: z.number().optional(),
});
const translatedTextSchema = z.object({
  translation: z
    .object({ language: z.string().optional(), text: z.string().optional() })
    .array()
    .optional(),
});
const mtaFeedSchema = z.object({
  entity: z
    .object({
      alert: z
        .object({
          active_period: periodSchema.array().optional(),
          description_text: translatedTextSchema.optional(),
          header_text: translatedTextSchema.optional(),
          informed_entity: z
            .object({ route_id: z.string().optional() })
            .array()
            .optional(),
          "transit_realtime.mercury_alert": z
            .object({
              alert_type: z.string().optional(),
              human_readable_active_period: translatedTextSchema.optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .array()
    .optional(),
});

type Period = z.infer<typeof periodSchema>;
type TranslatedText = z.infer<typeof translatedTextSchema>;

export default defineTool({
  description:
    "Check current MTA subway and bus service alerts from the public MTA feed. Use this for live route status and before recommending a specific train or bus. It can also include future planned work.",
  inputSchema: z.object({
    includePlanned: z.boolean().default(false),
    limit: z.number().int().min(1).max(40).default(12),
    mode: z.enum(["subway", "bus", "all"]).default("subway"),
    routes: z.array(z.string()).optional(),
  }),
  async execute({ includePlanned, limit, mode, routes }, ctx) {
    const wanted = routes
      ?.map((route) => route.trim().toUpperCase())
      .filter(Boolean);
    const selectedFeeds =
      mode === "all" ? (["subway", "bus"] as const) : ([mode] as const);
    const results = await Promise.all(
      selectedFeeds.map(async (feed) => {
        const response = await fetch(feeds[feed], { signal: ctx.abortSignal });
        if (!response.ok) {
          throw new Error(
            `MTA ${feed} alerts returned HTTP ${String(response.status)}.`
          );
        }
        return { data: mtaFeedSchema.parse(await response.json()), feed };
      })
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    const alerts = results.flatMap(({ data, feed }) =>
      (data.entity ?? []).flatMap((entity) => {
        const alert = entity.alert;
        if (!alert) return [];
        const periods = alert.active_period ?? [];
        const live = isLive(periods, nowSeconds);
        if (!live && !(includePlanned && isUpcoming(periods, nowSeconds))) {
          return [];
        }
        const alertRoutes = [
          ...new Set(
            (alert.informed_entity ?? []).flatMap(({ route_id: routeId }) =>
              routeId ? [routeId] : []
            )
          ),
        ];
        if (
          wanted?.length &&
          !alertRoutes.some((route) => wanted.includes(route.toUpperCase()))
        ) {
          return [];
        }
        const summary = plainText(alert.header_text);
        if (!summary) return [];
        const mercury = alert["transit_realtime.mercury_alert"];
        const alertType = mercury?.alert_type ?? "Service Change";
        const window = relevantPeriod(periods, nowSeconds);
        return [
          {
            activePeriod:
              plainText(mercury?.human_readable_active_period) ?? null,
            alertType,
            details: plainText(alert.description_text) ?? null,
            inEffectNow: live,
            mode: feed,
            plannedWork: alertType.startsWith("Planned"),
            routes: alertRoutes,
            summary,
            windowEnd: window?.end
              ? new Date(window.end * 1000).toISOString()
              : null,
            windowStart: window?.start
              ? new Date(window.start * 1000).toISOString()
              : null,
          },
        ];
      })
    );

    alerts.sort((left, right) => {
      if (left.inEffectNow !== right.inEffectNow) {
        return Number(right.inEffectNow) - Number(left.inEffectNow);
      }
      const leftStart = left.windowStart ?? "";
      const rightStart = right.windowStart ?? "";
      return left.inEffectNow
        ? rightStart.localeCompare(leftStart)
        : leftStart.localeCompare(rightStart);
    });
    return {
      alerts: alerts.slice(0, limit),
      checkedAt: new Date().toISOString(),
      mode,
      routesRequested: wanted ?? null,
      totalMatching: alerts.length,
      upcomingWorkIncluded: includePlanned,
    };
  },
});

function isLive(periods: Period[], now: number) {
  return (
    periods.length === 0 ||
    periods.some(
      (period) =>
        (period.start ?? 0) <= now &&
        (period.end === undefined || period.end >= now)
    )
  );
}

function isUpcoming(periods: Period[], now: number) {
  return periods.some((period) => (period.start ?? 0) > now);
}

function relevantPeriod(periods: Period[], now: number) {
  return (
    periods.find(
      (period) =>
        (period.start ?? 0) <= now &&
        (period.end === undefined || period.end >= now)
    ) ??
    periods
      .filter((period) => (period.start ?? 0) > now)
      .toSorted((left, right) => (left.start ?? 0) - (right.start ?? 0))[0]
  );
}

function plainText(field?: TranslatedText) {
  const text =
    field?.translation?.find(
      (translation) =>
        translation.language === "en" && !translation.text?.includes("<")
    )?.text ?? field?.translation?.[0]?.text;
  return text
    ?.replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
