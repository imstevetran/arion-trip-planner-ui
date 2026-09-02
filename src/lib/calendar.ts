import type { TripResource } from "../types";

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10).replace(/-/g, "");
}

function dateValue(date: string): string {
  return date.replace(/-/g, "");
}

function utcDateTime(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function event(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

export function tripCalendarIcs(trip: TripResource): string {
  const timestamp = utcDateTime(new Date().toISOString());
  const events: string[] = [];

  for (const stop of trip.stops) {
    if (!stop.planned_date) continue;
    const duration = stop.expected_duration_hours ? `Estimated visit: ${stop.expected_duration_hours} hours.` : "";
    events.push(event([
      `UID:trip-stop-${stop.id}@arion`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${dateValue(stop.planned_date)}`,
      `DTEND;VALUE=DATE:${nextDate(stop.planned_date)}`,
      `SUMMARY:${escapeIcs(stop.place_name)}`,
      `DESCRIPTION:${escapeIcs(`${duration} Planned with Arion Trip Planner.`.trim())}`,
      ...(stop.latitude !== null && stop.longitude !== null ? [`GEO:${stop.latitude};${stop.longitude}`] : []),
    ]));
  }

  for (const flight of trip.flightOptions.filter((item) => item.selected)) {
    events.push(event([
      `UID:trip-flight-${flight.id}@arion`,
      `DTSTAMP:${timestamp}`,
      `DTSTART:${utcDateTime(flight.departure_time)}`,
      `DTEND:${utcDateTime(flight.arrival_time)}`,
      `SUMMARY:${escapeIcs(`${flight.carrier_name} ${flight.flight_number}`)}`,
      `DESCRIPTION:${escapeIcs(`Flight selected in Arion Trip Planner. Price: ${flight.price_vnd} VND.`)}`,
    ]));
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Arion//Trip Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function downloadTripCalendar(trip: TripResource): void {
  const blob = new Blob([tripCalendarIcs(trip)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.trip.destination_query.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "trip"}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
