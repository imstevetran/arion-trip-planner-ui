export type TripStatus =
  | "draft"
  | "planning"
  | "itinerary_locked"
  | "booking_in_progress"
  | "booked"
  | "cancelled";

export type Trip = {
  id: string;
  title: string | null;
  origin_query: string | null;
  destination_query: string;
  needs_flight: boolean;
  budget_vnd: number;
  start_date: string;
  end_date: string;
  status: TripStatus;
  // Real traveler contact details, captured via CustomerDetailsForm — see
  // setCustomerDetails in trip-planner-api. Required before a vehicle or
  // flight booking can be approved (Timeline.tsx gates the Approve button
  // on customer_full_name/customer_phone being set).
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_date_of_birth: string | null;
  customer_nationality: string;
  // Who's actually traveling — the assistant asks for this in chat and
  // calls setPartyComposition; searchAccommodation/searchFlights refuse
  // until it's set. null adults means "not asked yet".
  party_adults: number | null;
  party_children_ages: number[];
};

export type TripStop = {
  id: string;
  sequence: number;
  place_name: string;
  latitude: number | null;
  longitude: number | null;
  planned_date: string | null;
  expected_duration_hours: number | null;
  // Best-effort Wikipedia photo (no Google Places API key needed) — null
  // until geocoded and a nearby match with an image is found, which isn't
  // guaranteed for every stop.
  image_url: string | null;
  image_attribution: string | null;
};

export type TripFlightOption = {
  id: string;
  direction: "departure" | "return";
  carrier_name: string;
  flight_number: string;
  departure_time: string;
  arrival_time: string;
  price_vnd: number;
  traveloka_itinerary_id: string | null;
  selected: boolean;
};

export type TripAccommodationOption = {
  id: string;
  trip_stop_id: string;
  source: "brave_search" | "agoda";
  name: string;
  description: string | null;
  price_vnd_per_night: number | null;
  url: string | null;
  selected: boolean;
};

export type TripVehicleAssignment = {
  id: string;
  vehicle_id: string;
  estimated_daily_rate_vnd: number;
  estimated_total_km: number | null;
  estimated_extra_km_charge_vnd: number;
  approved: boolean;
  arion_booking_id: string | null;
};

export type TripVehicleOption = {
  id: string;
  vehicle_id: string;
  estimated_daily_rate_vnd: number;
  selected: boolean;
  vehicle: {
    id: string;
    license_plate: string;
    make: string;
    model: string;
    current_location: string | null;
  } | null;
};

export type TripBookingKind = "vehicle" | "accommodation" | "flight";
export type TripBookingStatus = "pending_approval" | "approved" | "booking" | "booked" | "failed" | "rejected";

export type TripBooking = {
  id: string;
  kind: TripBookingKind;
  status: TripBookingStatus;
  trip_flight_option_id: string | null;
  trip_accommodation_option_id: string | null;
  trip_vehicle_assignment_id: string | null;
  external_reference: string | null;
};

export type TripDisruption = {
  id: string;
  trip_booking_id: string;
  type: "flight_delay" | "flight_cancelled" | "accommodation_cancelled" | "vehicle_unavailable";
  detail: Record<string, unknown>;
  occurred_at: string;
  acknowledged_at: string | null;
};

export type TripRouteLeg = {
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  durationMinutes: number;
};

export type TripResource = {
  trip: Trip;
  stops: TripStop[];
  flightOptions: TripFlightOption[];
  accommodationOptions: TripAccommodationOption[];
  vehicleAssignment: TripVehicleAssignment | null;
  vehicleOptions: TripVehicleOption[];
  calendar: {
    provider: "google";
    syncedEventCount: number;
    lastSyncedAt: string | null;
    calendarUrl: string;
  } | null;
  route: {
    distanceKm: number;
    durationMinutes: number;
    geometry: Array<[number, number]>;
    legs: TripRouteLeg[];
  } | null;
  budget: { totalVnd: number; usedVnd: number; remainingVnd: number };
};

export type FleetVehicle = {
  id: string;
  license_plate: string;
  make: string;
  model: string;
  daily_rate_vnd: number;
  free_km_per_day: number;
  extra_km_rate_vnd: number;
  current_location: string | null;
};

export type SuggestedAction = { label: string; description?: string };

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  suggestedActions?: SuggestedAction[];
  calendarSync?: {
    status: "authorization_required" | "synced";
    syncedEventCount: number;
    authorizationUrl?: string;
    calendarUrl?: string;
  };
};
