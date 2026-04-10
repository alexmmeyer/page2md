import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const LANGUAGE_CLASS_PATTERN = /\blanguage-([a-z0-9_+-]+)/i;

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

