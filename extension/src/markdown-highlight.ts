import Prism from "prismjs";
import "prismjs/components/prism-markup.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-markdown.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlightMarkdownForPreview(source: string): string {
  if (!source.trim()) {
    return "";
  }
  try {
    return Prism.highlight(source, Prism.languages.markdown, "markdown");
  } catch {
    return escapeHtml(source);
  }
}
