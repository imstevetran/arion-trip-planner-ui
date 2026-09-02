import { useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import type { Locale } from "../lib/i18n";
import type { TripResource } from "../types";

export function CalendarExportButton({ trip, locale }: { trip: TripResource; locale: Locale }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendar = trip.calendar;

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      const result = await callTool<{ status: "authorization_required" | "synced"; authorizationUrl?: string }>("addPlanToGoogleCalendar");
      if (result.status === "authorization_required" && result.authorizationUrl) window.location.assign(result.authorizationUrl);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Calendar sync failed.");
    } finally {
      setBusy(false);
    }
  }

  if (calendar?.lastSyncedAt) {
    return <a className="calendar-export calendar-synced" href={calendar.calendarUrl} target="_blank" rel="noreferrer">
      {calendar.syncedEventCount} {locale === "vi" ? "events da dong bo" : "events synced"} ↗
    </a>;
  }

  return <span className="calendar-action">
    <button className="calendar-export" type="button" onClick={() => void sync()} disabled={busy}>
      {busy ? (locale === "vi" ? "Dang dong bo..." : "Syncing...") : (locale === "vi" ? "Dong bo Google Calendar" : "Sync Google Calendar")}
    </button>
    {error && <span className="calendar-error" role="status">{error}</span>}
  </span>;
}
