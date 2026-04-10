import type {
  ConversionBlock,
  ConversionJsonOutput,
  ConversionMeta,
  ExtractionReport,
} from "@/lib/types/conversion";

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) {
    return markdown;
  }
  return markdown.slice(end + 5);
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSections(markdown: string): Array<{ level: number; title: string }> {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+(.+)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      title: cleanInlineMarkdown(match[2]),
    }));
}

function parseTableCells(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, all) => !(index === 0 && cell === "") && !(index === all.length - 1 && cell === ""))
    .map((cell) => cleanInlineMarkdown(cell));
}

function parseBlocks(markdown: string): ConversionBlock[] {
  const lines = markdown.split("\n");
  const blocks: ConversionBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)\s*$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: cleanInlineMarkdown(headingMatch[2]),
      });
      index += 1;
      continue;
    }

    const codeStartMatch = line.match(/^```([^\s`]*)?/);
    if (codeStartMatch) {
      const language = (codeStartMatch[1] ?? "").trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].startsWith("```")) {
        index += 1;
      }
      blocks.push({
        type: "code",
        language,
        code: codeLines.join("\n"),
      });
      continue;
    }

    const isTableHeader =
      line.trim().startsWith("|") &&
      index + 1 < lines.length &&
      /^\|\s*[-:| ]+\|\s*$/.test(lines[index + 1].trim());
    if (isTableHeader) {
      const headers = parseTableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(parseTableCells(lines[index].trimEnd()));
        index += 1;
      }
      blocks.push({
        type: "table",
        headers,
        rows,
      });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [cleanInlineMarkdown(listMatch[3])];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].trimEnd();
        const nextMatch = next.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!nextMatch) {
          break;
        }
        items.push(cleanInlineMarkdown(nextMatch[3]));
        index += 1;
      }
      blocks.push({
        type: "list",
        ordered,
        items,
      });
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index];
      const trimmed = nextLine.trim();
      if (trimmed.length === 0) {
        break;
      }
      if (
        /^#{1,6}\s+/.test(trimmed) ||
        /^```/.test(trimmed) ||
        /^(\s*)([-*+]|\d+\.)\s+/.test(trimmed) ||
        (trimmed.startsWith("|") &&
          index + 1 < lines.length &&
          /^\|\s*[-:| ]+\|\s*$/.test(lines[index + 1].trim()))
      ) {
        break;
      }
      paragraphLines.push(nextLine.trimEnd());
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      text: cleanInlineMarkdown(paragraphLines.join(" ")),
    });
  }

  return blocks;
}

export function emitJsonOutput(
  markdown: string,
  meta: ConversionMeta,
  report: ExtractionReport,
): ConversionJsonOutput {
  const markdownBody = stripFrontmatter(markdown).trim();
  return {
    meta,
    report,
    markdown: markdownBody,
    sections: extractSections(markdownBody),
    blocks: parseBlocks(markdownBody),
  };
}

