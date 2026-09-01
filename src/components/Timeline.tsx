import { useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import { t, type Locale } from "../lib/i18n";
import { CarIcon, MapPinIcon, PlaneIcon, TriangleAlertIcon } from "./icons";
import type {
  FleetVehicle,
  TripAccommodationOption,
  TripBooking,
  TripDisruption,
  TripFlightOption,
  TripResource,
} from "../types";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

function bookingFor(bookings: TripBooking[], key: keyof TripBooking, id: string): TripBooking | undefined {
  return bookings.find((booking) => booking[key] === id);
}

function ApprovalRow({
  booking,
  locale,
  onChanged,
}: {
  booking: TripBooking | undefined;
  locale: Locale;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!booking) return null;

  async function act(action: "approveBooking" | "rejectBooking") {
    if (!booking) return;
    setBusy(true);
    try {
      await callTool(action, { tripBookingId: booking.id });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (booking.status === "booked") return <span className="status-pill booked">{t(locale, "booked")}</span>;
  if (booking.status === "rejected") return <span className="status-pill warn">{t(locale, "rejected")}</span>;
  if (booking.status === "failed") return <span className="status-pill warn">{t(locale, "failed")}</span>;
  if (booking.status !== "pending_approval" && booking.status !== "approved") return null;

  return (
    <div className="stop-actions">
      <button className="btn approve" disabled={busy} onClick={() => act("approveBooking")}>
        {t(locale, "approve")}
      </button>
      <button className="btn reject" disabled={busy} onClick={() => act("rejectBooking")}>
        {t(locale, "reject")}
      </button>
    </div>
  );
}

function AccommodationOptions({
  options,
  locale,
  bookings,
  onChanged,
}: {
  options: TripAccommodationOption[];
  locale: Locale;
  bookings: TripBooking[];
  onChanged: () => void;
}) {
  if (options.length === 0) return null;
  const selected = options.find((option) => option.selected);

  return (
    <div className="option-list">
      {options.map((option) => (
        <div key={option.id} className={`option-row${option.selected ? " selected" : ""}`}>
          <span>
            {option.name}
            {option.price_vnd_per_night ? ` · ${formatVnd(option.price_vnd_per_night)}/night` : ""}
          </span>
          {!option.selected && (
            <button
              type="button"
              onClick={async () => {
                await callTool("selectAccommodation", { optionId: option.id });
                onChanged();
              }}
            >
              {t(locale, "approve") === "Approve" ? "Select" : "Chọn"}
            </button>
          )}
        </div>
      ))}
      {selected && <ApprovalRow booking={bookingFor(bookings, "trip_accommodation_option_id", selected.id)} locale={locale} onChanged={onChanged} />}
    </div>
  );
}

export function Timeline({
  trip,
  bookings,
  disruptions,
  fleet,
  locale,
  onChanged,
}: {
  trip: TripResource;
  bookings: TripBooking[];
  disruptions: TripDisruption[];
  fleet: FleetVehicle[];
  locale: Locale;
  onChanged: () => void;
}) {
  const activeDisruption = disruptions.find((disruption) => !disruption.acknowledged_at);
  const selectedFlights = trip.flightOptions.filter((option) => option.selected);
  const vehicle = fleet.find((candidate) => candidate.id === trip.vehicleAssignment?.vehicle_id);
  const days = trip.stops.reduce<Record<string, typeof trip.stops>>((groups, stop) => {
    const key = stop.planned_date ?? "unscheduled";
    (groups[key] ??= []).push(stop);
    return groups;
  }, {});

  return (
    <div className="app-main">
      <div className="app-topbar">
        <div>
          <p className="trip-title">{trip.trip.destination_query}</p>
          <p className="trip-sub">
            {trip.trip.start_date} – {trip.trip.end_date} · {trip.trip.status}
          </p>
        </div>
        <div className="budget-block">
          <div className="budget-label">{t(locale, "budgetUsed")}</div>
          <div className="budget-figs mono">
            {formatVnd(trip.budget.usedVnd)} / {formatVnd(trip.budget.totalVnd)}
          </div>
          <div className="budget-bar">
            <i style={{ width: `${Math.min(100, (trip.budget.usedVnd / Math.max(1, trip.budget.totalVnd)) * 100)}%` }} />
          </div>
        </div>
      </div>

      {activeDisruption && (
        <div className="disruption-banner">
          <TriangleAlertIcon />
          <span>
            {activeDisruption.type} — {JSON.stringify(activeDisruption.detail)}
          </span>
        </div>
      )}

      <div className="timeline-scroll">
        {trip.trip.needs_flight && selectedFlights.length > 0 && (
          <div className="day-group">
            <div className="day-label">
              <PlaneIcon /> Flight
            </div>
            {selectedFlights.map((option: TripFlightOption) => (
              <div className="stop-card" key={option.id}>
                <div className="stop-icon">
                  <PlaneIcon />
                </div>
                <div className="stop-body">
                  <div className="stop-top">
                    <span className="stop-name">
                      {option.carrier_name} {option.flight_number}
                    </span>
                    <span className="mono stop-meta">{formatVnd(option.price_vnd)}</span>
                  </div>
                  <div className="stop-meta mono">
                    {new Date(option.departure_time).toLocaleString()} → {new Date(option.arrival_time).toLocaleString()}
                  </div>
                  <ApprovalRow booking={bookingFor(bookings, "trip_flight_option_id", option.id)} locale={locale} onChanged={onChanged} />
                </div>
              </div>
            ))}
          </div>
        )}

        {Object.entries(days).map(([date, stops]) => (
          <div className="day-group" key={date}>
            <div className="day-label">{date === "unscheduled" ? "—" : date}</div>
            {stops.map((stop) => (
              <div className="stop-card" key={stop.id}>
                <div className="stop-icon">
                  <MapPinIcon />
                </div>
                <div className="stop-body">
                  <div className="stop-top">
                    <span className="stop-name">{stop.place_name}</span>
                    {stop.expected_duration_hours && <span className="mono stop-meta">{stop.expected_duration_hours}h</span>}
                  </div>
                  <AccommodationOptions
                    options={trip.accommodationOptions.filter((option) => option.trip_stop_id === stop.id)}
                    locale={locale}
                    bookings={bookings}
                    onChanged={onChanged}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}

        {trip.vehicleAssignment && (
          <div className="day-group">
            <div className="section-title">Vehicle</div>
            <div className="stop-card">
              <div className="stop-icon">
                <CarIcon />
              </div>
              <div className="stop-body">
                <div className="stop-top">
                  <span className="stop-name">{vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate}` : "Vehicle"}</span>
                  <span className="mono stop-meta">{formatVnd(trip.vehicleAssignment.estimated_daily_rate_vnd)}/day</span>
                </div>
                {trip.vehicleAssignment.estimated_extra_km_charge_vnd > 0 && (
                  <div className="stop-meta">+{formatVnd(trip.vehicleAssignment.estimated_extra_km_charge_vnd)} extra-km</div>
                )}
                <ApprovalRow
                  booking={bookingFor(bookings, "trip_vehicle_assignment_id", trip.vehicleAssignment.id)}
                  locale={locale}
                  onChanged={onChanged}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
