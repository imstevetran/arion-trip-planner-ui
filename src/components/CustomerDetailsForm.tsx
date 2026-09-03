import { useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import { t, type Locale } from "../lib/i18n";

// Shown in place of the Approve button on a vehicle/flight booking row
// until the trip has real traveler contact details — see
// trip-planner-api's setCustomerDetails/executeRealBooking. Before this
// existed, approveBooking sent a hardcoded placeholder identity ("Trip
// Planner Customer", a fake email/phone) to both the real vehicle-booking
// API and Traveloka's real flight-booking API, so a real rental/PNR was
// being created for nobody real.
export function CustomerDetailsForm({
  locale,
  onSaved,
}: {
  locale: Locale;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || !phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await callTool("setCustomerDetails", {
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(dob ? { dateOfBirth: dob } : {}),
      });
      onSaved();
    } catch {
      setError(t(locale, "chatError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="customer-details-form" onSubmit={submit}>
      <div className="customer-details-title">{t(locale, "customerDetailsTitle")}</div>
      <p className="customer-details-hint">{t(locale, "customerDetailsHint")}</p>
      <input
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        placeholder={t(locale, "customerDetailsFullName")}
        required
      />
      <input
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder={t(locale, "customerDetailsPhone")}
        required
      />
      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={t(locale, "customerDetailsEmail")}
        type="email"
      />
      <label className="customer-details-dob-label">
        {t(locale, "customerDetailsDob")}
        <input value={dob} onChange={(event) => setDob(event.target.value)} type="date" />
      </label>
      {error && <p className="customer-details-error">{error}</p>}
      <button type="submit" className="btn approve" disabled={busy || !fullName.trim() || !phone.trim()}>
        {busy ? t(locale, "customerDetailsSaving") : t(locale, "customerDetailsSave")}
      </button>
    </form>
  );
}
