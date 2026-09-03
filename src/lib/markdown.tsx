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

// A GFM table row: "| a | b |" — split on unescaped pipes after trimming
// the leading/trailing pipe. Cells with a literal "\|" aren't a case the
// assistant's own output produces (see routeSuggestion.ts's system prompt),
// so unescaping isn't handled — this only needs to parse what the model
// actually emits, not arbitrary markdown input.
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// "| --- | :---: | ---: |" — every cell only dashes/colons. Requiring this
// on the line right after a candidate header row is what tells a table
// apart from a paragraph that merely starts and ends with "|" for some
// unrelated reason.
function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cells = parseTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
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

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const isTableHeader = line.startsWith("|") && line.endsWith("|") && isTableSeparatorRow(lines[i + 1] ?? "");

    if (line === "") {
      flushParagraph();
      flushList();
    } else if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="md-hr" />);
    } else if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const key = `h-${blocks.length}`;
      blocks.push(
        <p key={key} className={`md-h md-h${level}`}>
          {renderInline(headingMatch[2], key)}
        </p>,
      );
    } else if (isTableHeader) {
      flushParagraph();
      flushList();
      const headerCells = parseTableRow(line);
      const bodyRows: string[][] = [];
      i += 2; // skip the header row (already read) and its separator row
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        bodyRows.push(parseTableRow(lines[i]));
        i += 1;
      }
      i -= 1; // the outer loop's own increment accounts for the last row consumed
      const key = `table-${blocks.length}`;
      blocks.push(
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headerCells.map((cell, index) => (
                  <th key={index}>{renderInline(cell, `${key}-h-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headerCells.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInline(row[cellIndex] ?? "", `${key}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
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
