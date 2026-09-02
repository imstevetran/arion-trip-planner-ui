import type { Locale } from "./i18n";

export type TripSuggestion = {
  id: string;
  destination: string;
  origin: string;
  originVi: string;
  budgetVnd: number;
  days: number;
  labelEn: string;
  labelVi: string;
};

// One shared list drives both surfaces: form mode uses the raw fields to
// prefill inputs, chat mode turns the same fields into a natural-language
// message. Picked for geographic spread (central coast, highlands, island,
// northern mountains) rather than trying to track real trending data.
export const TRIP_SUGGESTIONS: TripSuggestion[] = [
  {
    id: "da-nang-hoi-an",
    destination: "Da Nang, Hoi An",
    origin: "Hanoi",
    originVi: "Hà Nội",
    budgetVnd: 6_000_000,
    days: 3,
    labelEn: "Da Nang & Hoi An",
    labelVi: "Đà Nẵng & Hội An",
  },
  {
    id: "da-lat",
    destination: "Da Lat",
    origin: "Ho Chi Minh City",
    originVi: "TP. Hồ Chí Minh",
    budgetVnd: 5_000_000,
    days: 3,
    labelEn: "Da Lat",
    labelVi: "Đà Lạt",
  },
  {
    id: "phu-quoc",
    destination: "Phu Quoc",
    origin: "Ho Chi Minh City",
    originVi: "TP. Hồ Chí Minh",
    budgetVnd: 8_000_000,
    days: 4,
    labelEn: "Phu Quoc",
    labelVi: "Phú Quốc",
  },
  {
    id: "sa-pa",
    destination: "Sa Pa",
    origin: "Hanoi",
    originVi: "Hà Nội",
    budgetVnd: 4_500_000,
    days: 3,
    labelEn: "Sa Pa",
    labelVi: "Sa Pa",
  },
];

// A near-future date reads better as a suggestion than an empty field or
// today's date (which a 3-day trip could no longer start on by the time the
// form loads) — three weeks out, on the nose, no particular reason beyond
// "clearly in the future."
export function suggestionStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 21);
  return date.toISOString().slice(0, 10);
}

export function suggestionLabel(suggestion: TripSuggestion, locale: Locale): string {
  return locale === "vi" ? suggestion.labelVi : suggestion.labelEn;
}

export function suggestionToChatMessage(suggestion: TripSuggestion, locale: Locale): string {
  const startDate = suggestionStartDate();
  const budget = suggestion.budgetVnd.toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
  if (locale === "vi") {
    return `Mình muốn đi ${suggestion.labelVi} từ ${suggestion.originVi}, ngân sách ${budget} VND, bắt đầu ${startDate}, ${suggestion.days} ngày.`;
  }
  return `I want to go to ${suggestion.labelEn} from ${suggestion.origin}, budget ${budget} VND, starting ${startDate}, ${suggestion.days} days.`;
}
