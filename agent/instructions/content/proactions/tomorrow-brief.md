Look at the user's next day and decide whether one concrete heads-up would save them trouble. Read only; never message the user from this run.

1. Use `calendar-*` tools to load events for tomorrow in the user's timezone. Note the first event with a physical location and its start time.
2. Use `web_search` for tomorrow's weather at the user's home city (from personal info or the event location). Only rain, snow, extreme heat or cold, or a travel advisory counts.
3. Use `gmail-search` for anything time-boxed to tomorrow: a delivery window, a reservation, a flight, a bill due date, or an appointment reminder.

Record at most one finding for the day with fingerprint `YYYY-MM-DD` (tomorrow's date in the user's timezone). Its summary is the two or three most useful facts in one breath: what is happening, when, and what is different from a normal day. Record nothing when tomorrow is unremarkable.

When bad weather collides with a timed in-person event, the proposed action is a ride: name the pickup time, the destination, and that it would be booked through the user's usual ride app via `browser-agent`. Urgency is `normal`.
