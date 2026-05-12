import type { CSSProperties, ReactNode } from "react";

type ChatMarkdownProps = {
  animate?: boolean;
  className?: string;
  content: string;
};

type TableAlignment = "center" | "left" | "right";

type MarkdownTable = {
  alignments: TableAlignment[];
  headers: string[];
  rows: string[][];
};

function revealStyle(index: number): CSSProperties {
  return {
    "--chat-reveal-index": index,
  } as CSSProperties;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[\s\S]+?\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (value.startsWith("`") && value.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-foreground/8 px-1.5 py-0.5 font-mono text-[0.92em]"
        >
          {value.slice(1, -1)}
        </code>
      );
    } else if (value.startsWith("**") && value.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`} className="font-semibold">
          {renderInlineMarkdown(value.slice(2, -2), `${keyPrefix}-strong-${tokenIndex}`)}
        </strong>
      );
    } else {
      const linkMatch = value.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);

      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-muted"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(value);
      }
    }

    lastIndex = index + value.length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function isBlockBoundary(line: string) {
  const trimmed = line.trim();

  return (
    !trimmed ||
    trimmed.startsWith("```") ||
    /^#{1,3}\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed)
  );
}

function splitTableCells(line: string) {
  let trimmed = line.trim();

  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }

  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    const nextCharacter = trimmed[index + 1];

    if (character === "\\" && nextCharacter === "|") {
      current += "|";
      index += 1;
      continue;
    }

    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());

  return cells;
}

function parseTableDivider(line: string) {
  const cells = splitTableCells(line);

  if (cells.length < 2 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    return null;
  }

  return cells.map((cell): TableAlignment => {
    const startsWithColon = cell.startsWith(":");
    const endsWithColon = cell.endsWith(":");

    if (startsWithColon && endsWithColon) {
      return "center";
    }

    if (endsWithColon) {
      return "right";
    }

    return "left";
  });
}

function isHardBlockBoundary(line: string) {
  const trimmed = line.trim();

  return (
    !trimmed ||
    trimmed.startsWith("```") ||
    /^#{1,3}\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed)
  );
}

function isMarkdownTableStart(lines: string[], index: number) {
  const headerLine = lines[index]?.trim() ?? "";
  const dividerLine = lines[index + 1]?.trim() ?? "";

  return (
    headerLine.includes("|") &&
    splitTableCells(headerLine).length >= 2 &&
    parseTableDivider(dividerLine) !== null
  );
}

function normalizeTableRow(cells: string[], columnCount: number) {
  if (cells.length === columnCount) {
    return cells;
  }

  if (cells.length > columnCount) {
    return cells.slice(0, columnCount - 1).concat(cells.slice(columnCount - 1).join(" "));
  }

  return cells.concat(Array.from({ length: columnCount - cells.length }, () => ""));
}

function normalizeTableAlignments(alignments: TableAlignment[], columnCount: number) {
  return alignments.concat(
    Array.from({ length: Math.max(0, columnCount - alignments.length) }, () => "left" as const)
  ).slice(0, columnCount);
}

function parseMarkdownTable(lines: string[], startIndex: number) {
  if (!isMarkdownTableStart(lines, startIndex)) {
    return null;
  }

  const headers = splitTableCells(lines[startIndex] ?? "");
  const alignments = parseTableDivider(lines[startIndex + 1] ?? "") ?? [];
  const columnCount = Math.max(headers.length, alignments.length);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (isHardBlockBoundary(line) || !line.includes("|")) {
      break;
    }

    let cells = splitTableCells(line);
    index += 1;

    if (cells.length === 0 || cells.every((cell) => !cell)) {
      continue;
    }

    // Some submitted agents stream wide tables with each cell on a separate line.
    // Reassemble that common broken shape into a proper row before rendering.
    while (cells.length < columnCount && index < lines.length) {
      const continuation = lines[index]?.trim() ?? "";

      if (isHardBlockBoundary(continuation) || isMarkdownTableStart(lines, index)) {
        break;
      }

      if (continuation === "|") {
        index += 1;
        continue;
      }

      const continuationCells = continuation.includes("|")
        ? splitTableCells(continuation).filter(Boolean)
        : [continuation];

      if (continuationCells.length === 0) {
        break;
      }

      cells = cells.concat(continuationCells);
      index += 1;
    }

    rows.push(normalizeTableRow(cells, columnCount));
  }

  return {
    nextIndex: index,
    table: {
      alignments: normalizeTableAlignments(alignments, columnCount),
      headers: normalizeTableRow(headers, columnCount),
      rows,
    } satisfies MarkdownTable,
  };
}

function renderMarkdownTable(
  table: MarkdownTable,
  key: string,
  animate: boolean,
  revealIndex: number
) {
  return (
    <div
      key={key}
      className={`overflow-x-auto rounded-xl border border-border bg-background ${
        animate ? "chat-markdown-reveal-line" : ""
      }`}
      style={animate ? revealStyle(revealIndex) : undefined}
    >
      <table className="min-w-full border-collapse text-left text-xs leading-5">
        <thead className="bg-foreground/5 text-foreground">
          <tr>
            {table.headers.map((header, cellIndex) => (
              <th
                key={`${key}-head-${cellIndex}`}
                className="border-b border-border px-3 py-2 font-semibold"
                style={{ textAlign: table.alignments[cellIndex] ?? "left" }}
              >
                {renderInlineMarkdown(header || `Column ${cellIndex + 1}`, `${key}-head-${cellIndex}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`} className="border-b border-border last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${key}-row-${rowIndex}-${cellIndex}`}
                  className="px-3 py-2 align-top text-foreground/84"
                  style={{ textAlign: table.alignments[cellIndex] ?? "left" }}
                >
                  {renderInlineMarkdown(cell, `${key}-row-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChatMarkdown({
  animate = false,
  className = "",
  content,
}: ChatMarkdownProps) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className={`overflow-x-auto rounded-xl bg-foreground/8 p-3 text-xs leading-6 ${
            animate ? "chat-markdown-reveal-line" : ""
          }`}
          style={animate ? revealStyle(blocks.length) : undefined}
        >
          {language ? (
            <span className="mb-2 block text-[10px] uppercase tracking-[0.14em] text-muted">
              {language}
            </span>
          ) : null}
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const tableResult = parseMarkdownTable(lines, index);

    if (tableResult) {
      blocks.push(
        renderMarkdownTable(
          tableResult.table,
          `table-${blocks.length}`,
          animate,
          blocks.length
        )
      );
      index = tableResult.nextIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (heading) {
      const HeadingTag = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
      blocks.push(
        <HeadingTag
          key={`heading-${blocks.length}`}
          className={`pt-2 text-[0.95rem] font-semibold leading-6 ${
            animate ? "chat-markdown-reveal-line" : ""
          }`}
          style={animate ? revealStyle(blocks.length) : undefined}
        >
          {renderInlineMarkdown(heading[2], `heading-${blocks.length}`)}
        </HeadingTag>
      );
      index += 1;
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];

      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        const match = ordered
          ? candidate.match(/^\d+[.)]\s+(.+)$/)
          : candidate.match(/^[-*]\s+(.+)$/);

        if (!match) {
          break;
        }

        items.push(match[1]);
        index += 1;
      }

      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${blocks.length}`}
          className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, itemIndex) => (
            <li
              key={`${item}-${itemIndex}`}
              className={`pl-1 ${animate ? "chat-markdown-reveal-line" : ""}`}
              style={animate ? revealStyle(blocks.length + itemIndex) : undefined}
            >
              {renderInlineMarkdown(item, `list-${blocks.length}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;

    while (
      index < lines.length &&
      !isBlockBoundary(lines[index] ?? "") &&
      !isMarkdownTableStart(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${blocks.length}`}>
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <span
            key={`${paragraphLine}-${paragraphIndex}`}
            className={animate ? "chat-markdown-reveal-line block" : undefined}
            style={animate ? revealStyle(blocks.length + paragraphIndex) : undefined}
          >
            {paragraphIndex > 0 && !animate ? <br /> : null}
            {renderInlineMarkdown(paragraphLine, `paragraph-${blocks.length}-${paragraphIndex}`)}
          </span>
        ))}
      </p>
    );
  }

  return (
    <div
      className={`space-y-3 whitespace-normal break-words ${
        animate ? "chat-markdown-reveal" : ""
      } ${className}`}
    >
      {blocks}
    </div>
  );
}
