import { useEffect, useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import { t, type Locale } from "../lib/i18n";
import { suggestionStartDate, type TripSuggestion } from "../lib/tripSuggestions";
import { preferenceBrief, type TravelPace, type TravelParty } from "../lib/tripPreferences";
import type { Trip } from "../types";

export function CreateTripForm({
  locale,
  prefill,
  getTurnstileToken,
  onCreated,
}: {
  locale: Locale;
  prefill?: TripSuggestion | null;
  getTurnstileToken: () => Promise<string>;
  onCreated: (trip: Trip, initialMessage: string) => void;
}) {
  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [budgetVnd, setBudgetVnd] = useState("6000000");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState("3");
  const [party, setParty] = useState<TravelParty>("couple");
  const [pace, setPace] = useState<TravelPace>("balanced");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fills whenever a different suggestion chip is clicked (keyed off
  // `prefill` itself changing) — a real destination/budget/days combo the
  // customer can still edit, not a locked-in choice.
  useEffect(() => {
    if (!prefill) return;
    setDestination(prefill.destination);
    setOrigin(prefill.origin);
    setBudgetVnd(String(prefill.budgetVnd));
    setDays(String(prefill.days));
    setStartDate(suggestionStartDate());
  }, [prefill]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!destination.trim() || !startDate) return;
    setBusy(true);
    setError(null);
    try {
      const turnstileToken = await getTurnstileToken();
      const trip = await callTool<Trip>(
        "createTrip",
        {
          destination: destination.trim(),
          origin: origin.trim() || undefined,
          budgetVnd: Number(budgetVnd),
          startDate,
          days: Number(days),
        },
        turnstileToken,
      );
      onCreated(trip, preferenceBrief({ party, pace }, locale));
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
      <details className="optional-details">
        <summary>{locale === "vi" ? "Thêm điểm xuất phát (tuỳ chọn)" : "Add origin (optional)"}</summary>
        <label>
          {t(locale, "origin")}
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Hanoi" />
        </label>
      </details>
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
      <fieldset className="quick-preferences">
        <legend>{locale === "vi" ? "Đi cùng ai?" : "Who are you travelling with?"}</legend>
        <div className="preference-chips">
          {(["solo", "couple", "family", "friends"] as const).map((item) => (
            <button type="button" aria-pressed={party === item} className={party === item ? "selected" : ""} key={item} onClick={() => setParty(item)}>
              {{ solo: locale === "vi" ? "Một mình" : "Solo", couple: locale === "vi" ? "Cặp đôi" : "Couple", family: locale === "vi" ? "Gia đình" : "Family", friends: locale === "vi" ? "Bạn bè" : "Friends" }[item]}
            </button>
          ))}
        </div>
        <p className="preference-label">{locale === "vi" ? "Nhịp độ mong muốn" : "Preferred pace"}</p>
        <div className="preference-chips">
          {(["easy", "balanced", "full"] as const).map((item) => (
            <button type="button" aria-pressed={pace === item} className={pace === item ? "selected" : ""} key={item} onClick={() => setPace(item)}>
              {{ easy: locale === "vi" ? "Thư thả" : "Easy", balanced: locale === "vi" ? "Cân bằng" : "Balanced", full: locale === "vi" ? "Khám phá nhiều" : "Explore more" }[item]}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p style={{ color: "var(--rose)", fontSize: 12.5 }}>{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "…" : t(locale, "createTrip")}
      </button>
    </form>
  );
}
