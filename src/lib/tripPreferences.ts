import type { Locale } from "./i18n";

export type TravelParty = "solo" | "couple" | "family" | "friends";
export type TravelPace = "easy" | "balanced" | "full";
export type TripPreferences = { party: TravelParty; pace: TravelPace };

const partyLabels: Record<Locale, Record<TravelParty, string>> = {
  en: { solo: "solo", couple: "as a couple", family: "with family", friends: "with friends" },
  vi: { solo: "một mình", couple: "theo cặp đôi", family: "cùng gia đình", friends: "cùng bạn bè" },
};
const paceLabels: Record<Locale, Record<TravelPace, string>> = {
  en: { easy: "a relaxed pace", balanced: "a balanced pace", full: "a full exploration pace" },
  vi: { easy: "lịch trình thư thả", balanced: "lịch trình cân bằng", full: "lịch trình khám phá nhiều" },
};

export function preferenceBrief(preferences: TripPreferences, locale: Locale): string {
  if (locale === "vi") return `Tôi đi ${partyLabels.vi[preferences.party]} và muốn ${paceLabels.vi[preferences.pace]}. Hãy dùng các ưu tiên này khi tạo lịch trình và đề xuất lựa chọn.`;
  return `I'm travelling ${partyLabels.en[preferences.party]} and prefer ${paceLabels.en[preferences.pace]}. Use this when creating the itinerary and recommendations.`;
}

export function planSearchBrief(style: "value" | "balanced" | "comfort", locale: Locale): string {
  const label = locale === "vi"
    ? { value: "tiết kiệm", balanced: "cân bằng", comfort: "thoải mái" }[style]
    : { value: "best value", balanced: "balanced", comfort: "comfort" }[style];
  if (locale === "vi") return `Tôi muốn lập lịch trình theo hướng ${label}. Hãy tạo hoặc tinh chỉnh route phù hợp với ưu tiên này trước, nêu ngắn gọn trade-off chính, và chưa tìm/đặt dịch vụ nào.`;
  return `I want a ${label} planning style. Create or refine the route around that preference first, briefly state the main trade-off, and do not search or book services yet.`;
}
