import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { t, type Locale } from "../lib/i18n";
import { renderInline, renderMarkdown } from "../lib/markdown";
import { SendIcon } from "./icons";
import type { ChatMessage, SuggestedAction } from "../types";

type ChatTurnResponse = {
  reply: string;
  tripId: string | null;
  toolCalls: string[];
  suggestedActions?: SuggestedAction[];
};

// Keyed by message index — ephemeral, per-render-only UI state for the
// checkbox + Confirm/Cancel panel under a message's suggestedActions.
// Deliberately not folded into ChatMessage itself: the history poll can
// replace the whole `messages` array wholesale, and re-deriving "which
// message a given selection belongs to" from a stable id isn't possible
// since history messages have no id, only position.
type ActionsUiState = { selected: Set<string>; dismissed: boolean };

function SuggestedActionsPanel({
  actions,
  uiState,
  onToggle,
  onConfirm,
  onCancel,
  locale,
}: {
  actions: SuggestedAction[];
  uiState: ActionsUiState;
  onToggle: (label: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  locale: Locale;
}) {
  if (uiState.dismissed) return null;
  return (
    <div className="suggested-actions">
      {actions.map((action) => (
        <label className="suggested-action-row" key={action.label}>
          <input
            type="checkbox"
            checked={uiState.selected.has(action.label)}
            onChange={() => onToggle(action.label)}
          />
          <span>
            <strong>{action.label}</strong>
            {action.description ? <> — {renderInline(action.description, action.label)}</> : null}
          </span>
        </label>
      ))}
      <div className="suggested-action-buttons">
        <button type="button" className="btn reject" onClick={onCancel}>
          {t(locale, "cancel")}
        </button>
        <button
          type="button"
          className="btn approve"
          disabled={uiState.selected.size === 0}
          onClick={onConfirm}
        >
          {t(locale, "confirm")}
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({
  tripId,
  locale,
  onTripIdChange,
  onToolCallsExecuted,
  externalMessage,
  onExternalMessageSent,
  getTurnstileToken,
}: {
  tripId: string | null;
  locale: Locale;
  onTripIdChange: (id: string) => void;
  onToolCallsExecuted: () => void;
  // A suggestion chip elsewhere in the UI can push a ready-made message in
  // here and have it sent immediately, same as if the customer had typed
  // and pressed send themselves.
  externalMessage?: string | null;
  onExternalMessageSent?: () => void;
  // Only provided (and only needed) pre-trip — see CreateTripEntry. Once a
  // trip exists, this panel is a different mounted instance entirely (the
  // app shell's, in App.tsx) and every message already carries a real
  // tripId, so there's nothing here for Turnstile to gate.
  getTurnstileToken?: () => Promise<string>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionsUi, setActionsUi] = useState<Record<number, ActionsUiState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHistoryLength = useRef(0);

  // Poll chat history so a backend-initiated disruption turn (see
  // trip-planner-api's chat/disruptionTurn.ts) shows up here without the
  // customer having said anything — a real push channel (SSE) would replace
  // this polling loop, kept simple for now.
  //
  // Fetches once immediately on mount, not just on the first interval tick:
  // this component remounts fresh (empty `messages`) the instant a trip gets
  // created, because that swaps CreateTripEntry's chat panel out for the app
  // shell's — confirmed live, the reply that created the trip would
  // otherwise vanish from view for up to 4s while the new instance waited
  // for its first poll.
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    async function poll() {
      try {
        const data = await apiGet<{ messages: ChatMessage[] }>(`/chat/${tripId}/history`);
        if (cancelled) return;
        if (data.messages.length !== lastHistoryLength.current) {
          lastHistoryLength.current = data.messages.length;
          setMessages(data.messages);
          setActionsUi({});
        }
      } catch {
        // transient — next poll will retry
      }
    }
    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tripId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    // Also waits on `busy` — send() itself no-ops while a previous turn is
    // still in flight, so without this a chip clicked mid-reply would get
    // silently dropped (this effect would still fire once, send() would
    // bail, and the pending message would already be cleared). Re-running
    // when busy flips back to false retries it instead of losing it.
    if (!externalMessage || busy) return;
    void send(externalMessage);
    onExternalMessageSent?.();
    // Deliberately omits send/onExternalMessageSent — send closes over
    // draft/tripId/locale, which change every render and would turn this
    // into a resend loop if included.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMessage, busy]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || busy) return;
    if (overrideText === undefined) setDraft("");
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      // Every message before a trip exists is a potential createTrip call —
      // the model decides which one actually triggers it, so this can't be
      // narrowed to just the triggering turn. See trip-planner-api's
      // routes/chat.ts.
      const turnstileToken = !tripId ? await getTurnstileToken?.() : undefined;
      const result = await apiPost<ChatTurnResponse>("/chat", {
        tripId,
        message: text,
        locale,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", text: result.reply, suggestedActions: result.suggestedActions },
      ]);
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

  function toggleAction(index: number, label: string) {
    setActionsUi((current) => {
      const existing = current[index] ?? { selected: new Set<string>(), dismissed: false };
      const selected = new Set(existing.selected);
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      return { ...current, [index]: { ...existing, selected } };
    });
  }

  function dismissActions(index: number) {
    setActionsUi((current) => ({
      ...current,
      [index]: { selected: current[index]?.selected ?? new Set(), dismissed: true },
    }));
  }

  function confirmActions(index: number) {
    const selected = actionsUi[index]?.selected;
    if (!selected || selected.size === 0) return;
    dismissActions(index);
    void send(`${t(locale, "actionsConfirmedPrefix")}${Array.from(selected).join(", ")}.`);
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
            <div className="bubble">
              {message.role === "assistant" ? renderMarkdown(message.text) : message.text}
            </div>
            {message.role === "assistant" && message.suggestedActions && message.suggestedActions.length > 0 && (
              <SuggestedActionsPanel
                actions={message.suggestedActions}
                uiState={actionsUi[index] ?? { selected: new Set(), dismissed: false }}
                onToggle={(label) => toggleAction(index, label)}
                onConfirm={() => confirmActions(index)}
                onCancel={() => dismissActions(index)}
                locale={locale}
              />
            )}
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
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
