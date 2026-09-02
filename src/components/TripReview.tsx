import { useMemo, useState } from "react";
import { callTool } from "../lib/webmcp/tools";
import type { Locale } from "../lib/i18n";
import type { TripBooking, TripResource } from "../types";

function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(amount))} ₫`;
}

function tripDays(trip: TripResource["trip"]): number {
  const start = Date.parse(`${trip.start_date}T00:00:00Z`);
  const end = Date.parse(`${trip.end_date}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.round((end - start) / 86_400_000) + 1) : 1;
}

function bookingLabel(booking: TripBooking, trip: TripResource, locale: Locale): string {
  if (booking.kind === "flight") {
    const option = trip.flightOptions.find((item) => item.id === booking.trip_flight_option_id);
    return option ? `${option.carrier_name} ${option.flight_number}` : locale === "vi" ? "Chuyến bay" : "Flight";
  }
  if (booking.kind === "accommodation") {
    const option = trip.accommodationOptions.find((item) => item.id === booking.trip_accommodation_option_id);
    return option?.name ?? (locale === "vi" ? "Lưu trú" : "Accommodation");
  }
  return locale === "vi" ? "Xe thuê" : "Vehicle";
}

export function CostBreakdown({ trip, locale, onAskAssistant }: { trip: TripResource; locale: Locale; onAskAssistant: (message: string) => void }) {
  const days = tripDays(trip.trip);
  const flights = trip.flightOptions.filter((item) => item.selected).reduce((total, item) => total + item.price_vnd, 0);
  const accommodationPerNight = trip.accommodationOptions.filter((item) => item.selected).reduce((total, item) => total + (item.price_vnd_per_night ?? 0), 0);
  const vehicle = trip.vehicleAssignment
    ? trip.vehicleAssignment.estimated_daily_rate_vnd * days + trip.vehicleAssignment.estimated_extra_km_charge_vnd
    : 0;
  const quotedSubtotal = flights + vehicle;

  return <section className="trip-review-card cost-card" aria-labelledby="cost-title">
    <div className="trip-review-heading">
      <div><p className="eyebrow">{locale === "vi" ? "Ngân sách" : "Budget"}</p><h2 id="cost-title">{locale === "vi" ? "Chi phí đã biết" : "Known costs"}</h2></div>
      <strong>{formatVnd(trip.budget.usedVnd)} / {formatVnd(trip.budget.totalVnd)}</strong>
    </div>
    <div className="cost-lines">
      {flights > 0 && <p><span>{locale === "vi" ? "Chuyến bay" : "Flights"}</span><b>{formatVnd(flights)}</b></p>}
      {accommodationPerNight > 0 && <p><span>{locale === "vi" ? "Lưu trú" : "Accommodation"}<small>{locale === "vi" ? "giá mỗi đêm" : "per night"}</small></span><b>{formatVnd(accommodationPerNight)}<small>/night</small></b></p>}
      {vehicle > 0 && <p><span>{locale === "vi" ? "Xe thuê" : "Vehicle"}<small>{days} {locale === "vi" ? "ngày + phí km" : "days + km fees"}</small></span><b>{formatVnd(vehicle)}</b></p>}
      {quotedSubtotal === 0 && <p className="cost-empty">{locale === "vi" ? "Chưa có báo giá nào được chọn." : "No quotes selected yet."}</p>}
    </div>
    <p className="cost-note">{locale === "vi" ? "Tổng ở trên dùng giá agent đã chọn. Thuế, hành lý, ăn uống và hoạt động chỉ được tính khi agent xác nhận báo giá all-in." : "This reflects selected agent quotes. Taxes, bags, food, and activities need an all-in quote before approval."}</p>
    <button className="link-button" type="button" onClick={() => onAskAssistant(locale === "vi" ? "Hãy kiểm tra toàn bộ chi phí cho chuyến đi này và trả về breakdown all-in gồm thuế, hành lý, lưu trú, xe, xăng/cầu đường, hoạt động, ăn uống và khoản dự phòng. Nêu rõ mục nào chưa xác minh. Chưa đặt dịch vụ nào." : "Check the full trip cost and return an all-in breakdown including taxes, bags, accommodation, vehicle, fuel/tolls, activities, food, and contingency. Clearly mark anything unverified. Do not book anything.")}>{locale === "vi" ? "Kiểm tra tổng chi phí all-in →" : "Check all-in total →"}</button>
  </section>;
}

export function FeasibilityReview({ trip, locale, onAskAssistant }: { trip: TripResource; locale: Locale; onAskAssistant: (message: string) => void }) {
  const issues = useMemo(() => {
    const result: string[] = [];
    if (trip.stops.some((stop) => !stop.planned_date)) result.push(locale === "vi" ? "Có điểm đến chưa được xếp ngày." : "Some stops are not assigned to a day.");
    const byDay = trip.stops.reduce<Record<string, number>>((days, stop) => {
      if (stop.planned_date) days[stop.planned_date] = (days[stop.planned_date] ?? 0) + (stop.expected_duration_hours ?? 0);
      return days;
    }, {});
    if (Object.values(byDay).some((hours) => hours > 8)) result.push(locale === "vi" ? "Có ngày có hơn 8 giờ hoạt động, chưa gồm di chuyển." : "At least one day has over 8 activity hours before travel time.");
    const averageDrive = trip.route ? trip.route.durationMinutes / 60 / tripDays(trip.trip) : 0;
    if (averageDrive > 3) result.push(locale === "vi" ? "Thời gian lái xe trung bình vượt 3 giờ/ngày." : "Average driving time exceeds 3 hours per day.");
    return result;
  }, [locale, trip]);

  return <section className="trip-review-card feasibility-card" aria-labelledby="feasibility-title">
    <div className="trip-review-heading"><div><p className="eyebrow">{locale === "vi" ? "Tính khả thi" : "Feasibility"}</p><h2 id="feasibility-title">{issues.length ? (locale === "vi" ? "Cần rà soát trước khi đặt" : "Review before booking") : (locale === "vi" ? "Lịch trình có cấu trúc ổn" : "Schedule structure looks sound")}</h2></div><span className={`readiness-dot ${issues.length ? "warning" : "ok"}`} /></div>
    {issues.length ? <ul className="review-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="review-ok">{locale === "vi" ? "Không có xung đột cấu trúc từ lịch trình hiện tại." : "No structural conflicts found in the current itinerary."}</p>}
    <p className="cost-note">{locale === "vi" ? "Giờ mở cửa, check-in, thời tiết và tình trạng giao thông phải được kiểm tra bằng dữ liệu live." : "Opening hours, check-in, weather, and traffic need a live-data check."}</p>
    <button className="link-button" type="button" onClick={() => onAskAssistant(locale === "vi" ? "Hãy kiểm tra tính khả thi cho lịch trình hiện tại: giờ mở cửa/ngày đóng cửa, check-in/check-out, thời gian từ sân bay, thời gian di chuyển thực tế, buffer trễ chuyến và thời tiết. Chỉ ra xung đột, rồi đề xuất cách sửa ngắn gọn. Chưa đặt dịch vụ nào." : "Check the current itinerary for opening/closing times, check-in/out, airport transfers, real travel time, delay buffers, and weather. Identify conflicts and suggest concise fixes. Do not book anything.")}>{locale === "vi" ? "Kiểm tra lịch trình với dữ liệu live →" : "Run a live feasibility check →"}</button>
  </section>;
}

export function BookingReview({ trip, bookings, locale, onChanged }: { trip: TripResource; bookings: TripBooking[]; locale: Locale; onChanged: () => void }) {
  const pending = bookings.filter((booking) => booking.status === "pending_approval" || booking.status === "approved");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (pending.length === 0) return null;
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  async function approveSelected() {
    if (selected.size === 0) return;
    setBusy(true); setError(null);
    try {
      await Promise.all(Array.from(selected, (tripBookingId) => callTool("approveBooking", { tripBookingId })));
      setSelected(new Set()); onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  return <section className="trip-review-card booking-review" aria-labelledby="booking-review-title">
    <div className="trip-review-heading"><div><p className="eyebrow">{locale === "vi" ? "Xác nhận của bạn" : "Your approval"}</p><h2 id="booking-review-title">{locale === "vi" ? `Rà soát ${pending.length} dịch vụ trước khi đặt` : `Review ${pending.length} services before booking`}</h2></div></div>
    <div className="booking-checks">{pending.map((booking) => <label key={booking.id}><input type="checkbox" checked={selected.has(booking.id)} onChange={() => toggle(booking.id)} /><span>{bookingLabel(booking, trip, locale)}</span><small>{booking.kind}</small></label>)}</div>
    <p className="cost-note">{locale === "vi" ? "Chỉ các mục bạn chọn mới được gửi để đặt. Hãy kiểm tra tổng tiền và điều kiện huỷ trong chat trước khi xác nhận." : "Only selected items will be booked. Check the total and cancellation terms in chat before confirming."}</p>
    {error && <p className="review-error">{error}</p>}
    <button className="btn approve" type="button" disabled={busy || selected.size === 0} onClick={() => void approveSelected()}>{busy ? "…" : (locale === "vi" ? `Duyệt ${selected.size || ""} dịch vụ đã chọn` : `Approve ${selected.size || ""} selected`)}</button>
  </section>;
}
