import type { ConversionMeta } from "@/lib/types/conversion";

export function markdownWithYamlFrontmatter(
  markdownBody: string,
  meta: ConversionMeta,
): string {
  if (meta.sourceType === "paste") {
    return markdownBody;
  }

  return [
    "---",
    `title: "${meta.title.replaceAll('"', '\\"')}"`,
    `sourceType: "${meta.sourceType}"`,
    `source: "${meta.source.replaceAll('"', '\\"')}"`,
    `convertedAt: "${meta.convertedAt}"`,
    "---",
    "",
    markdownBody,
  ].join("\n");
}
