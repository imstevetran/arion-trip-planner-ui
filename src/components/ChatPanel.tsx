import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { t, type Locale } from "../lib/i18n";
import { SendIcon } from "./icons";
import type { ChatMessage } from "../types";

type ChatTurnResponse = { reply: string; tripId: string | null; toolCalls: string[] };

export function ChatPanel({
  tripId,
  locale,
  onTripIdChange,
  onToolCallsExecuted,
}: {
  tripId: string | null;
  locale: Locale;
  onTripIdChange: (id: string) => void;
  onToolCallsExecuted: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHistoryLength = useRef(0);

  // Poll chat history so a backend-initiated disruption turn (see
  // trip-planner-api's chat/disruptionTurn.ts) shows up here without the
  // customer having said anything — a real push channel (SSE) would replace
  // this polling loop, kept simple for now.
  useEffect(() => {
    if (!tripId) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiGet<{ messages: ChatMessage[] }>(`/chat/${tripId}/history`);
        if (data.messages.length !== lastHistoryLength.current) {
          lastHistoryLength.current = data.messages.length;
          setMessages(data.messages);
        }
      } catch {
        // transient — next poll will retry
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [tripId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      const result = await apiPost<ChatTurnResponse>("/chat", { tripId, message: text, locale });
      setMessages((current) => [...current, { role: "assistant", text: result.reply }]);
      lastHistoryLength.current += 2;
      if (result.tripId && result.tripId !== tripId) onTripIdChange(result.tripId);
      if (result.toolCalls.length > 0) onToolCallsExecuted();
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <h3>{t(locale, "chat")}</h3>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && <p className="empty-hint">{t(locale, "noTripYet")}</p>}
        {messages.map((message, index) => (
          <div className={`msg ${message.role}`} key={index}>
            <div className="bubble">{message.text}</div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
          placeholder={t(locale, "chatPlaceholder")}
          disabled={busy}
        />
        <button className="send-btn" onClick={() => void send()} disabled={busy || !draft.trim()}>
          <SendIcon style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  );
}
