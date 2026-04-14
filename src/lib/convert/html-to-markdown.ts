import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const LANGUAGE_CLASS_PATTERN = /\blanguage-([a-z0-9_+-]+)/i;
const FONT_WEIGHT_BOLD_PATTERN = /font-weight\s*:\s*(bold|bolder|[6-9]00)/i;

const ALIGN_BORDER: Record<string, string> = {
  left: ":--",
  right: "--:",
  center: ":-:",
};

/**
 * turndown-plugin-gfm only recognizes a header row inside the first tbody when
 * the tbody has no previous element sibling (or an empty thead). Confluence
 * tables insert <colgroup> before <tbody>, so the plugin keeps the full table
 * as HTML. This mirrors GFM table logic with a broader "first tbody" check and
 * header detection on element children only (ignores whitespace text nodes).
 */
function isSkippableBeforeFirstTbody(node: ChildNode | null): boolean {
  let current: ChildNode | null = node;
  while (current) {
    if (current.nodeType === 3) {
      if (!/^\s*$/.test(current.textContent ?? "")) {
        return false;
      }
      current = current.previousSibling;
      continue;
    }
    if (current.nodeType !== 1) {
      return false;
    }
    const name = (current as Element).nodeName;
    if (name === "COLGROUP" || name === "COL" || name === "CAPTION") {
      current = current.previousSibling;
      continue;
    }
    if (name === "THEAD") {
      return /^\s*$/i.test((current as Element).textContent ?? "");
    }
    return false;
  }
  return true;
}

function isFirstTbodyForHeader(tr: Element): boolean {
  const parent = tr.parentElement;
  if (!parent || parent.nodeName !== "TBODY") {
    return false;
  }
  return isSkippableBeforeFirstTbody(parent.previousSibling);
}

function rowIsAllTh(tr: Element): boolean {
  const cells = tr.children;
  if (cells.length === 0) {
    return false;
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].nodeName !== "TH") {
      return false;
    }
  }
  return true;
}

function isGfmHeadingRow(tr: Element): boolean {
  const parent = tr.parentElement;
  if (!parent) {
    return false;
  }
  if (parent.nodeName === "THEAD") {
    return rowIsAllTh(tr);
  }
  if (parent.firstElementChild !== tr) {
    return false;
  }
  if (parent.nodeName === "TABLE" || isFirstTbodyForHeader(tr)) {
    return rowIsAllTh(tr);
  }
  return false;
}

function tableCellPrefix(node: Element): string {
  const parent = node.parentElement;
  if (!parent) {
    return " ";
  }
  const rowCells = parent.children;
  let index = 0;
  for (; index < rowCells.length; index++) {
    if (rowCells[index] === node) {
      break;
    }
  }
  return index === 0 ? "| " : " ";
}

function gfmTableCell(content: string, node: Element): string {
  return `${tableCellPrefix(node)}${content} |`;
}

function normalizeTableCellContent(content: string, node: Element): string {
  const compact = content
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Confluence headers are often <th><p><strong>Header</strong></p></th>.
  // In markdown tables, the header row itself already implies emphasis.
  const withoutRedundantHeaderBold =
    node.nodeName === "TH"
      ? compact.replace(/^\*\*(.+)\*\*$/u, "$1")
      : compact;

  // Keep literal pipes inside a cell from being interpreted as column splits.
  return withoutRedundantHeaderBold.replace(/(?<!\\)\|/g, "\\|");
}

const gfmTableCellFixed: TurndownService.Rule = {
  filter: ["th", "td"],
  replacement(content, node) {
    const normalized = normalizeTableCellContent(content, node);
    return gfmTableCell(normalized, node);
  },
};

const gfmTableRowFixed: TurndownService.Rule = {
    filter: "tr",
    replacement(content, node) {
      const el = node as Element;
      let borderCells = "";
      if (isGfmHeadingRow(el)) {
        const cells = el.children;
        for (let i = 0; i < cells.length; i++) {
          const cellEl = cells[i];
          let border = "---";
          const align = (cellEl.getAttribute("align") ?? "").toLowerCase();
          if (align && ALIGN_BORDER[align]) {
            border = ALIGN_BORDER[align];
          }
          borderCells += gfmTableCell(border, cellEl);
        }
      }
      return `\n${content}${borderCells ? `\n${borderCells}` : ""}`;
    },
  };

const gfmTableFixed: TurndownService.Rule = {
  filter(node) {
    if (node.nodeName !== "TABLE") {
      return false;
    }
    const table = node as HTMLTableElement;
    const firstRow = table.rows[0];
    return !!firstRow && isGfmHeadingRow(firstRow);
  },
  replacement(content) {
    const normalized = content.replace(/\n{2,}/g, "\n");
    return `\n\n${normalized}\n\n`;
  },
};

function detectLanguage(codeElement: Element | null): string {
  if (!codeElement) {
    return "";
  }

  const className = codeElement.getAttribute("class") ?? "";
  const fromClass = className.match(LANGUAGE_CLASS_PATTERN)?.[1];
  if (fromClass) {
    return fromClass.toLowerCase();
  }

  const dataLanguage =
    codeElement.getAttribute("data-language") ??
    codeElement.getAttribute("data-lang") ??
    "";

  return dataLanguage.toLowerCase();
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    bulletListMarker: "-",
  });

  turndown.use(gfm);

  // After colgroup/caption, Confluence's first header row still needs GFM tables.
  turndown.addRule("gfmTableCellConfluence", gfmTableCellFixed);
  turndown.addRule("gfmTableRowConfluence", gfmTableRowFixed);
  turndown.addRule("gfmTableConfluence", gfmTableFixed);

  // Rich text pastes often encode emphasis in inline styles instead of <strong>.
  turndown.addRule("styledSpanBold", {
    filter(node) {
      if (node.nodeName !== "SPAN") {
        return false;
      }
      const style = node.getAttribute("style") ?? "";
      return FONT_WEIGHT_BOLD_PATTERN.test(style);
    },
    replacement(content) {
      const trimmed = content.trim();
      if (!trimmed) {
        return "";
      }
      return `**${trimmed}**`;
    },
  });

  // Preserve fenced code blocks with language labels when detectable.
  turndown.addRule("fencedCodeLanguage", {
    filter(node) {
      return (
        node.nodeName === "PRE" &&
        node.firstElementChild?.nodeName === "CODE"
      );
    },
    replacement(_content, node) {
      const codeNode = node.firstElementChild;
      const language = detectLanguage(codeNode);
      const rawCode = codeNode?.textContent ?? node.textContent ?? "";
      const normalizedCode = rawCode.replace(/\n$/, "");
      return `\n\n\`\`\`${language}\n${normalizedCode}\n\`\`\`\n\n`;
    },
  });

  const markdown = turndown.turndown(html);
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

