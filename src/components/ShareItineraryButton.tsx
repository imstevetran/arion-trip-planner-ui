import { useState } from "react";
import type { Locale } from "../lib/i18n";

export function ShareItineraryButton({ tripId, destination, locale }: { tripId: string; destination: string; locale: Locale }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("share", tripId);
    url.hash = "";

    const title = locale === "vi" ? `Lịch trình ${destination}` : `${destination} itinerary`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: locale === "vi" ? "Xem lịch trình chuyến đi cùng mình" : "View our trip itinerary", url: url.toString() });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button className="share-itinerary" type="button" onClick={() => void share()}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
      </svg>
      {copied ? (locale === "vi" ? "Đã sao chép" : "Copied") : (locale === "vi" ? "Chia sẻ" : "Share")}
    </button>
  );
}
