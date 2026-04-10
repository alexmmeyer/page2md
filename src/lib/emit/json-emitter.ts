import type { ConversionJsonOutput, ConversionMeta, ExtractionReport } from "@/lib/types/conversion";

function extractSections(markdown: string): Array<{ level: number; title: string }> {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+(.+)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      level: match[1].length,
      title: match[2].trim(),
    }));
}

export function emitJsonOutput(
  markdown: string,
  meta: ConversionMeta,
  report: ExtractionReport,
): ConversionJsonOutput {
  return {
    meta,
    report,
    markdown,
    sections: extractSections(markdown),
  };
}

