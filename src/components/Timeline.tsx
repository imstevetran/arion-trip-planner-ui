import { useEffect, useRef, useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import { t, type Locale } from "../lib/i18n";
import { CarIcon, MapPinIcon, PlaneIcon, TriangleAlertIcon } from "./icons";
import { BookingReview, CostBreakdown, FeasibilityReview } from "./TripReview";
import { CalendarExportButton } from "./CalendarExportButton";
import { ShareItineraryButton } from "./ShareItineraryButton";
import type {
  FleetVehicle,
  TripAccommodationOption,
  TripBooking,
  TripBookingKind,
  TripDisruption,
  TripFlightOption,
  TripResource,
  TripRouteLeg,
  TripVehicleOption,
} from "../types";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;
}

// One row per stop showing how the customer gets there from the previous
// stop — self-drive only (this product doesn't have a per-leg vehicle yet,
// just the eventual whole-trip assignment), so "Drive" plus ORS's estimated
// distance/duration for that specific leg (route.legs from trip://current,
// see trip-planner-api's routes/resources.ts). `vehicleSlot` renders the
// vehicle assignment/picker inline on the FIRST driving leg only (see
// Timeline's firstDrivingLegStopId) — that's where the rental car is
// actually needed from, not a disconnected section at the end of the
// itinerary. A trip is one continuous self-drive segment today (no way yet
// to mark a later leg as "by flight/boat instead," which would be where a
// second vehicle choice would make sense), so one inline picker covers it.
function TravelLeg({
  leg,
  locale,
  vehicleSlot,
}: {
  leg: TripRouteLeg;
  locale: Locale;
  vehicleSlot?: React.ReactNode;
}) {
  return (
    <div className="travel-leg">
      <CarIcon />
      <span>
        {t(locale, "drive")} · {leg.distanceKm} km · {formatDuration(leg.durationMinutes)}
      </span>
      {vehicleSlot && <div className="travel-leg-vehicle">{vehicleSlot}</div>}
    </div>
  );
}

function bookingFor(bookings: TripBooking[], key: keyof TripBooking, id: string): TripBooking | undefined {
  return bookings.find((booking) => booking[key] === id);
}

// Vehicle and flight bookings execute a real reservation/ticket under the
// traveler's name (trip-planner-api's executeRealBooking) — accommodation
// doesn't yet (Brave-search results are self-booked by the customer via a
// link, not booked through us), so it's the only kind that doesn't need
// this gate.
export const KINDS_REQUIRING_CUSTOMER_DETAILS: TripBookingKind[] = ["vehicle", "flight"];

function ApprovalRow({
  booking,
  kind,
  hasCustomerDetails,
  locale,
  onChanged,
}: {
  booking: TripBooking | undefined;
  kind: TripBookingKind;
  hasCustomerDetails: boolean;
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

  // The actual name/phone/DOB form now lives in the chat panel (a card ChatPanel
  // shows whenever this same condition is true — see App.tsx's
  // needsCustomerDetails) rather than inline here, which used to make every
  // pending booking card bulky with a 4-field form. This is just a pointer.
  if (KINDS_REQUIRING_CUSTOMER_DETAILS.includes(kind) && !hasCustomerDetails) {
    return <p className="stop-meta customer-details-pending-hint">{t(locale, "customerDetailsInChatHint")}</p>;
  }

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

// No ApprovalRow here, unlike AccommodationOptions — picking a vehicle
// calls assignVehicle directly, which immediately creates the real
// trip_vehicle_assignment row and stages its booking, so the existing
// "assigned vehicle" block further down (keyed off trip.vehicleAssignment,
// which has the actual assignment id ApprovalRow needs) already renders
// the approve/reject controls once that shows up on the next poll.
function VehicleOptions({
  options,
  locale,
  onChanged,
  onCancel,
}: {
  options: TripVehicleOption[];
  locale: Locale;
  onChanged: () => void;
  onCancel?: () => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="option-list">
      {options.map((option) => (
        <div key={option.id} className={`option-row${option.selected ? " selected" : ""}`}>
          <span>
            {option.vehicle ? `${option.vehicle.make} ${option.vehicle.model}` : "Vehicle"}
            {` · ${formatVnd(option.estimated_daily_rate_vnd)}/day`}
          </span>
          {!option.selected && (
            <button
              type="button"
              onClick={async () => {
                await callTool("assignVehicle", { vehicleId: option.vehicle_id });
                onChanged();
              }}
            >
              {t(locale, "approve") === "Approve" ? "Select" : "Chọn"}
            </button>
          )}
        </div>
      ))}
      {onCancel && (
        <button type="button" className="link-btn" onClick={onCancel}>
          {t(locale, "cancel")}
        </button>
      )}
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
      {selected && <ApprovalRow booking={bookingFor(bookings, "trip_accommodation_option_id", selected.id)} kind="accommodation" hasCustomerDetails locale={locale} onChanged={onChanged} />}
    </div>
  );
}

const DIRECTION_LABEL: Record<TripFlightOption["direction"], { en: string; vi: string }> = {
  departure: { en: "Outbound", vi: "Chuyến đi" },
  return: { en: "Return", vi: "Chuyến về" },
};

// One picker per direction (outbound/return each have their own candidate
// list) — mirrors AccommodationOptions' shape, just grouped. selectFlight
// (trip-planner-api) resets *all* selections on every call and only
// re-selects whatever traveloka_itinerary_ids it's given, so picking a new
// outbound has to resubmit the still-selected return alongside it (and
// vice versa) or that direction's selection gets silently wiped.
function FlightOptions({
  options,
  locale,
  bookings,
  hasCustomerDetails,
  readOnly,
  onChanged,
}: {
  options: TripFlightOption[];
  locale: Locale;
  bookings: TripBooking[];
  hasCustomerDetails: boolean;
  readOnly: boolean;
  onChanged: () => void;
}) {
  if (options.length === 0) return null;
  const directions = Array.from(new Set(options.map((option) => option.direction)));

  async function select(itineraryId: string, direction: TripFlightOption["direction"]) {
    const keepFromOtherDirection = options.find(
      (option) => option.direction !== direction && option.selected && option.traveloka_itinerary_id,
    );
    await callTool("selectFlight", {
      itineraryIds: [itineraryId, ...(keepFromOtherDirection ? [keepFromOtherDirection.traveloka_itinerary_id] : [])],
    });
    onChanged();
  }

  return (
    <>
      {directions.map((direction) => {
        const directionOptions = options.filter((option) => option.direction === direction);
        const selected = directionOptions.find((option) => option.selected);
        return (
          <div key={direction} className="flight-direction">
            <div className="section-title">{DIRECTION_LABEL[direction][locale]}</div>
            <div className="option-list">
              {directionOptions.map((option) => (
                <div key={option.id} className={`option-row${option.selected ? " selected" : ""}`}>
                  <span>
                    <span className="flight-option-main">{option.carrier_name} {option.flight_number} · {formatVnd(option.price_vnd)}</span>
                    <span className="mono stop-meta flight-option-times">
                      {new Date(option.departure_time).toLocaleString()} → {new Date(option.arrival_time).toLocaleString()}
                    </span>
                  </span>
                  {!option.selected && !readOnly && option.traveloka_itinerary_id && (
                    <button type="button" onClick={() => select(option.traveloka_itinerary_id as string, direction)}>
                      {t(locale, "approve") === "Approve" ? "Select" : "Chọn"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {selected && !readOnly && (
              <ApprovalRow
                booking={bookingFor(bookings, "trip_flight_option_id", selected.id)}
                kind="flight"
                hasCustomerDetails={hasCustomerDetails}
                locale={locale}
                onChanged={onChanged}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function Timeline({
  trip,
  tripId,
  bookings,
  disruptions,
  fleet,
  locale,
  onChanged,
  embedded = false,
  onAskAssistant,
  readOnly = false,
  stopToHighlight,
  onStopClick,
}: {
  trip: TripResource;
  tripId: string;
  bookings: TripBooking[];
  disruptions: TripDisruption[];
  fleet: FleetVehicle[];
  locale: Locale;
  onChanged: () => void;
  embedded?: boolean;
  onAskAssistant: (message: string) => void;
  readOnly?: boolean;
  // The Map → Plan direction: App.tsx sets this (a fresh object each time)
  // when a map pin is clicked — scrolls that stop's card into view and
  // highlights it briefly.
  stopToHighlight?: { stopId: string } | null;
  // The reverse direction — called when a stop card is clicked, so App.tsx
  // can tell RouteMap to pan to and open that pin.
  onStopClick?: (stopId: string) => void;
}) {
  const activeDisruption = disruptions.find((disruption) => !disruption.acknowledged_at);
  const hasCustomerDetails = Boolean(trip.trip.customer_full_name && trip.trip.customer_phone);
  const vehicle = fleet.find((candidate) => candidate.id === trip.vehicleAssignment?.vehicle_id);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);

  // Scrolls the target stop card into view and flags it for a brief
  // highlight animation (see .stop-card.highlighted in index.css), cleared
  // after the animation's own duration so it doesn't linger as permanent
  // "selected" state.
  useEffect(() => {
    if (!stopToHighlight) return;
    const el = document.getElementById(`stop-${stopToHighlight.stopId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedStopId(stopToHighlight.stopId);
    const clear = window.setTimeout(() => setHighlightedStopId(null), 2000);
    return () => window.clearTimeout(clear);
  }, [stopToHighlight]);

  // .day-label's sticky `top` used to be a hardcoded px guess at the sticky
  // .app-topbar's height — it drifted out of sync on mobile (where the
  // topbar wraps to more lines for a long destination name or when
  // ShareItineraryButton/CalendarExportButton both render), so the date
  // pill stuck partway *behind* the topbar instead of right below it.
  // Measuring the real height keeps it correct regardless of content or
  // viewport width.
  const topbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    // entry.contentRect excludes the topbar's own padding, undershooting the
    // sticky offset .day-label actually needs (which is measured to the
    // border box, like getBoundingClientRect) — read that directly instead.
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--topbar-height", `${el.getBoundingClientRect().height}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const days = trip.stops.reduce<Record<string, typeof trip.stops>>((groups, stop) => {
    const key = stop.planned_date ?? "unscheduled";
    (groups[key] ??= []).push(stop);
    return groups;
  }, {});

  // Where the rental car is actually needed from — the destination stop of
  // the itinerary's first driving leg, not a disconnected "Vehicle" section
  // at the end. See TravelLeg's vehicleSlot.
  const firstDrivingLegStopId = trip.route?.legs[0]?.toStopId;
  const vehicleBooking = trip.vehicleAssignment
    ? bookingFor(bookings, "trip_vehicle_assignment_id", trip.vehicleAssignment.id)
    : undefined;
  // assignVehicle (backend) already replaces the existing assignment rather
  // than rejecting a second call, so switching vehicles is just a matter of
  // showing the picker again — except once the booking is actually
  // "booked" (a real reservation went out), which is why that state alone
  // hides the button rather than gating on approval status.
  const canChangeVehicle = !readOnly && vehicleBooking?.status !== "booked";
  const vehicleContent = trip.vehicleAssignment && !showVehiclePicker ? (
    <div className="inline-vehicle">
      <div className="inline-vehicle-top">
        <CarIcon />
        <span className="stop-name">{vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate}` : "Vehicle"}</span>
        <span className="mono stop-meta">{formatVnd(trip.vehicleAssignment.estimated_daily_rate_vnd)}/day</span>
        {canChangeVehicle && (
          <button type="button" className="link-btn" onClick={() => setShowVehiclePicker(true)}>
            {t(locale, "changeVehicle")}
          </button>
        )}
      </div>
      {trip.vehicleAssignment.estimated_extra_km_charge_vnd > 0 && (
        <div className="stop-meta">+{formatVnd(trip.vehicleAssignment.estimated_extra_km_charge_vnd)} extra-km</div>
      )}
      {!readOnly && <ApprovalRow
        booking={vehicleBooking}
        kind="vehicle"
        hasCustomerDetails={hasCustomerDetails}
        locale={locale}
        onChanged={onChanged}
      />}
    </div>
  ) : trip.vehicleOptions.length > 0 && !readOnly ? (
    <VehicleOptions
      options={trip.vehicleOptions}
      locale={locale}
      onChanged={() => {
        setShowVehiclePicker(false);
        onChanged();
      }}
      onCancel={trip.vehicleAssignment ? () => setShowVehiclePicker(false) : undefined}
    />
  ) : null;

  return (
    <div className={embedded ? "timeline-main" : "app-main"}>
      <div className="app-topbar" ref={topbarRef}>
        <div>
          <p className="trip-title">{trip.trip.destination_query}</p>
          <p className="trip-sub">
            {trip.trip.start_date} – {trip.trip.end_date} · {trip.trip.status}
          </p>
        </div>
        <div className="topbar-actions">
          {!readOnly && <ShareItineraryButton tripId={tripId} destination={trip.trip.destination_query} locale={locale} />}
          {!readOnly && trip.trip.status !== "draft" && trip.trip.status !== "planning" && <CalendarExportButton trip={trip} locale={locale} />}
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
      </div>

      {activeDisruption && (
        <div className="disruption-banner">
          <TriangleAlertIcon />
          <span>
            {activeDisruption.type} — {JSON.stringify(activeDisruption.detail)}
          </span>
        </div>
      )}

      {!readOnly && <div className="trip-review-grid">
        <FeasibilityReview trip={trip} locale={locale} onAskAssistant={onAskAssistant} />
        <CostBreakdown trip={trip} locale={locale} onAskAssistant={onAskAssistant} />
      </div>}
      {!readOnly && <BookingReview trip={trip} bookings={bookings} locale={locale} onChanged={onChanged} />}

      <div className="timeline-scroll">
        {trip.trip.needs_flight && trip.flightOptions.length > 0 && (
          <div className="day-group">
            <div className="day-label">
              <PlaneIcon /> Flight
            </div>
            <FlightOptions
              options={trip.flightOptions}
              locale={locale}
              bookings={bookings}
              hasCustomerDetails={hasCustomerDetails}
              readOnly={readOnly}
              onChanged={onChanged}
            />
          </div>
        )}

        {Object.entries(days).map(([date, stops]) => (
          <div className="day-group" key={date}>
            <div className="day-label">{date === "unscheduled" ? "—" : date}</div>
            {stops.map((stop) => {
              const leg = trip.route?.legs.find((candidate) => candidate.toStopId === stop.id);
              return (
                <div key={stop.id}>
                  {leg && (
                    <TravelLeg
                      leg={leg}
                      locale={locale}
                      vehicleSlot={stop.id === firstDrivingLegStopId ? vehicleContent : undefined}
                    />
                  )}
                  <div
                    id={`stop-${stop.id}`}
                    className={`stop-card${highlightedStopId === stop.id ? " highlighted" : ""}${onStopClick ? " is-clickable" : ""}`}
                    onClick={onStopClick ? () => onStopClick(stop.id) : undefined}
                  >
                    <div className="stop-icon">
                      {stop.image_url ? (
                        <img className="stop-thumb" src={stop.image_url} alt="" loading="lazy" />
                      ) : (
                        <MapPinIcon />
                      )}
                    </div>
                    <div className="stop-body">
                      <div className="stop-top">
                        <span className="stop-name">{stop.place_name}</span>
                        {stop.expected_duration_hours && <span className="mono stop-meta">{stop.expected_duration_hours}h</span>}
                      </div>
                      <AccommodationOptions
                        options={trip.accommodationOptions.filter((option) => option.trip_stop_id === stop.id && (!readOnly || option.selected))}
                        locale={locale}
                        bookings={readOnly ? [] : bookings}
                        onChanged={onChanged}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Fallback only — normally vehicleContent renders inline at the
            first driving leg above. This covers the edge case where there
            is no driving leg at all yet (e.g. a single-stop trip, or the
            route hasn't been computed yet) but a vehicle was already
            searched/assigned, so it's never silently lost. */}
        {!firstDrivingLegStopId && vehicleContent && (
          <div className="day-group">
            <div className="section-title">Vehicle</div>
            {vehicleContent}
          </div>
        )}
      </div>
    </div>
  );
}
