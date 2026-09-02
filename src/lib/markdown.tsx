import type { ReactNode } from "react";

// A deliberately tiny, non-HTML markdown renderer for the chat bubble — the
// assistant's replies only ever use **bold**, "---" dividers, and "- " bullet
// lists (see trip-planner-api's chat/agent.ts system prompt), so a full
// markdown library (and the dangerouslySetInnerHTML/sanitizer pair that
// would come with rendering its HTML output) would be more surface area
// than this needs. Builds React elements directly — never raw HTML — so
// there's no injection risk from LLM-generated text.
export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? <strong key={`${keyPrefix}-${index}`}>{part}</strong> : part,
  );
}

export function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="md-p">
        {paragraphLines.map((line, index) => (
          <span key={index}>
            {index > 0 && <br />}
            {renderInline(line, `${key}-${index}`)}
          </span>
        ))}
      </p>,
    );
    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} className="md-ul">
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);

    if (line === "") {
      flushParagraph();
      flushList();
    } else if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="md-hr" />);
    } else if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  flushList();

  return blocks;
}
