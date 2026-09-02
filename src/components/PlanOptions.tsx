import { planSearchBrief } from "../lib/tripPreferences";
import type { Locale } from "../lib/i18n";

type Option = { id: "value" | "balanced" | "comfort"; title: Record<Locale, string>; description: Record<Locale, string>; tradeoff: Record<Locale, string> };
const options: Option[] = [
  { id: "value", title: { en: "Best value", vi: "Tiết kiệm" }, description: { en: "Prioritise the lowest all-in price.", vi: "Ưu tiên tổng chi phí thấp nhất." }, tradeoff: { en: "May mean less convenient times or locations.", vi: "Có thể kém thuận tiện về giờ hoặc vị trí." } },
  { id: "balanced", title: { en: "Balanced", vi: "Cân bằng" }, description: { en: "A practical mix of price, time, and comfort.", vi: "Cân đối chi phí, thời gian và sự thoải mái." }, tradeoff: { en: "Recommended starting point.", vi: "Lựa chọn nên xem đầu tiên." } },
  { id: "comfort", title: { en: "Comfort", vi: "Thoải mái" }, description: { en: "Prioritise better timing and less travel friction.", vi: "Ưu tiên giờ đẹp và ít mệt khi di chuyển." }, tradeoff: { en: "Usually uses more of the budget.", vi: "Thường dùng nhiều ngân sách hơn." } },
];

export function PlanOptions({ locale, onChoose }: { locale: Locale; onChoose: (message: string) => void }) {
  return <section className="plan-options" aria-labelledby="plan-options-title">
    <div className="plan-options-heading"><div><p className="eyebrow">{locale === "vi" ? "Chọn cách lập kế hoạch" : "Choose your planning style"}</p><h2 id="plan-options-title">{locale === "vi" ? "Ba lựa chọn rõ ràng, không cần lọc hàng chục kết quả" : "Three clear options, not dozens of filters"}</h2></div><p>{locale === "vi" ? "Chọn một hướng để agent tạo route trước; chưa có booking nào được tạo." : "Choose a direction for the route first; nothing is booked."}</p></div>
    <div className="plan-option-grid">{options.map((option) => <button className={`plan-option ${option.id}`} type="button" key={option.id} onClick={() => onChoose(planSearchBrief(option.id, locale))}><span className="plan-option-title">{option.title[locale]}</span><span>{option.description[locale]}</span><small>{option.tradeoff[locale]}</small><span className="plan-option-action">{locale === "vi" ? "Dùng hướng này →" : "Use this style →"}</span></button>)}</div>
  </section>;
}
