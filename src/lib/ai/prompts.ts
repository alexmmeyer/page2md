import type { ExtractionRegion } from "@/lib/types/conversion";

export function buildDetectSystemPrompt(): string {
  return [
    "You are an expert document structure analyst.",
    "Given candidate page regions, identify their purpose and content type so the user can choose which to convert.",
    "Prioritize regions that are visually and semantically distinct from one another.",
    "Prioritize a small set of distinct, non-overlapping regions whenever possible.",
    "Prefer semantically meaningful content and skip navigation chrome, ads, action rails, and repetitive boilerplate.",
    "Use text semantics and structure cues: heading hierarchy, link patterns, and whether links point within the current page versus other pages.",
    "Do not force regions into fixed archetypes; infer region purpose from the actual page content and layout each time.",
    "For each included region, provide a clear human-readable label (e.g. 'Main content', 'Navigation bar', 'Footer') and a brief description of what the region contains (e.g. 'API reference documentation for the Auth module', 'Blog post by Jane Smith about deployment strategies').",
    "Descriptions must be specific, must not just repeat the label, and should never end with the word 'region'.",
    "Return strict JSON only with the requested schema.",
  ].join(" ");
}

export function buildDetectUserPrompt(args: {
  title: string;
  source: string;
  candidates: ExtractionRegion[];
}): string {
  const renderedCandidates = args.candidates
    .map((candidate) => {
      return `- id=${candidate.id}; label=${candidate.label}; kind=${candidate.kind}; textLength=${candidate.textLength}; linkDensity=${candidate.linkDensity.toFixed(3)}; heuristicScore=${candidate.score}; preview=${JSON.stringify(candidate.previewText || "")}`;
    })
    .join("\n");

  return [
    `Page title: ${args.title || "Untitled page"}`,
    `Source: ${args.source}`,
    "",
    "Candidate regions:",
    renderedCandidates,
    "",
    "Task:",
    "1) pick the best distinct regions for markdown conversion (max 6 included), avoiding heavily overlapping regions",
    "2) give each a clear, human-readable label describing its role (e.g. 'Navigation bar', 'Main content', 'Sidebar links')",
    "3) give each a brief description of the content it contains — be specific about the topic, author, or purpose when possible (max ~120 chars, do not repeat label text, do not use the phrase '... region')",
    "4) provide confidence (0-1), score (0-100), and concise rationale",
    "5) mark non-useful regions with include=false",
  ].join("\n");
}

export function buildConvertSystemPrompt(): string {
  return [
    "You convert HTML fragments into clean, faithful markdown for technical documentation.",
    "Preserve structure and meaning; remove obvious navigation/UI clutter.",
    "Keep headings, lists, tables, links, and code blocks accurate.",
    "Return strict JSON only with the requested schema.",
  ].join(" ");
}

export function buildConvertUserPrompt(args: {
  source: string;
  title: string;
  selectedRegionLabel: string;
  html: string;
}): string {
  return [
    `Source: ${args.source}`,
    `Page title: ${args.title || "Untitled page"}`,
    `Selected region: ${args.selectedRegionLabel}`,
    "",
    "Convert the HTML below to high-quality markdown.",
    "Use ATX headings and fenced code blocks when applicable.",
    "HTML:",
    args.html,
  ].join("\n");
}
