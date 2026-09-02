import { useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import { t, type Locale } from "../lib/i18n";
import type { Trip } from "../types";

export function CreateTripForm({
  locale,
  onCreated,
}: {
  locale: Locale;
  onCreated: (trip: Trip) => void;
}) {
  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [budgetVnd, setBudgetVnd] = useState("6000000");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!destination.trim() || !startDate) return;
    setBusy(true);
    setError(null);
    try {
      const trip = await callTool<Trip>("createTrip", {
        destination: destination.trim(),
        origin: origin.trim() || undefined,
        budgetVnd: Number(budgetVnd),
        startDate,
        days: Number(days),
      });
      onCreated(trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-trip-body" onSubmit={handleSubmit}>
      <h1>{t(locale, "newTrip")}</h1>
      <label>
        {t(locale, "destination")}
        <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Da Nang, Hoi An" required />
      </label>
      <label>
        {t(locale, "origin")}
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Hanoi" />
      </label>
      <div className="row">
        <label>
          {t(locale, "budget")}
          <input type="number" min={0} value={budgetVnd} onChange={(e) => setBudgetVnd(e.target.value)} required />
        </label>
        <label>
          {t(locale, "days")}
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} required />
        </label>
      </div>
      <label>
        {t(locale, "startDate")}
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </label>
      {error && <p style={{ color: "var(--rose)", fontSize: 12.5 }}>{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "…" : t(locale, "createTrip")}
      </button>
    </form>
  );
}
