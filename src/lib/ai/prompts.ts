import type { ExtractionRegion, VisibleRegionCandidate } from "@/lib/types/conversion";

export function buildDetectSystemPrompt(opts: { devMode?: boolean } = {}): string {
  const base = [
    "You are an expert web page content analyst.",
    "You will receive a full-page screenshot of a rendered web page along with a list of visible candidate elements (bounding boxes, background colors, fonts, text previews, link densities, and nesting via childRefs).",
    "Your job is to identify which candidates are genuinely distinct, valuable content regions the user might want to export to markdown.",
    "",
    "ALWAYS EXCLUDE (set include=false):",
    "  • Site-wide page headers (logo + global nav)",
    "  • Site-wide page footers (legal text, copyright, social links)",
    "  • Cookie/consent banners",
    "  • Floating chat or support widgets",
    "  • Login/signup modals or prompts",
    "  • Ad slots",
    "  • Any candidate whose childRefs list contains another included candidate AND whose text is mostly just the sum of those children — prefer the more specific child.",
    "",
    "THINK LIKE A HUMAN looking at the page. Distinct regions are usually separated by:",
    "  • different background color or visible border",
    "  • clear positional separation (left sidebar, right rail, main column, top bar, bottom bar)",
    "  • different content type (navigation list vs article body vs in-page TOC)",
    "",
    "For every region you consider, apply five criteria:",
    "",
    "1. PURPOSE — What is the actual function? Use both the screenshot and the preview text. Be specific: 'left-side docs nav linking to other pages in this section', 'main article body', 'right-side in-page TOC', 'cookie consent banner'.",
    "",
    "2. VALUE — Would a human realistically want just this region as markdown? Include: article/doc bodies, structural navigation, in-page TOCs, reference tables, code examples. Exclude: UI chrome listed above.",
    "",
    "3. DISTINCTIVENESS — Is this region visually and semantically distinct from every other included region?",
    "",
    "4. NON-OVERLAP — Does this candidate substantially duplicate another? If a candidate's childRefs contains another included candidate with ≥90% of its text, exclude the parent and keep the child.",
    "",
    "5. ATOMICITY — Can this region be split into clearly different sub-regions that exist as separate candidates? If yes, prefer the sub-regions and exclude the broad container.",
    "",
    "ADDRESSING REGIONS — Return the candidate's `ref` (e.g. 'c12') exactly as given. Do not invent refs.",
    "",
    "LABELS — Be specific and descriptive based on what you actually see:",
    "  Good: 'Documentation navigation', 'Main article — Travel Redirect API Key', 'Page table of contents'",
    "  Bad: 'Section', 'Content', 'Main', 'Article', 'Container', 'div block'",
    "",
    "DESCRIPTIONS — Describe what the content IS (topic, subject matter, purpose). Max ~120 chars. Never just restate the label. Never end with 'region'.",
    "",
    "OUTPUT — Strict JSON only. Mark non-useful candidates with include=false. Surface at most 6 regions with include=true.",
  ];

  if (opts.devMode) {
    base.push(
      "",
      "DEV MODE — For every region you consider (included and excluded), populate the `reasoning` object with four fields:",
      "  • purpose: What you understand this region's function to be, drawing on both the screenshot and the metadata.",
      "  • importance: Why this region is (or is not) important enough to surface to the user.",
      "  • nonOverlap: Why this region does not duplicate the content of other included regions (or why it does and should be excluded).",
      "  • atomicity: Whether this region could be split into distinct sub-regions, whether those sub-regions exist as other candidates, and therefore whether the broad region should be included or excluded.",
    );
  }

  return base.join("\n");
}

/**
 * Compact serialization of a candidate for the user prompt. Kept terse so
 * we can fit many candidates without blowing past the token budget.
 */
function serializeVisionCandidate(c: VisibleRegionCandidate): string {
  const parts: string[] = [
    `[${c.ref}]`,
    `${c.tag}${c.role ? `[role=${c.role}]` : ""}`,
    `bbox=(${c.bbox.x},${c.bbox.y},${c.bbox.width}x${c.bbox.height})`,
    `bg=${c.bgColor}`,
    `font=${c.fontSize}/${c.fontWeight}`,
    `${c.textLength}chars`,
    `linkDensity=${c.linkDensity.toFixed(2)}`,
  ];
  if (c.ariaLabel) {
    parts.push(`aria="${c.ariaLabel.slice(0, 40)}"`);
  }
  if (c.className) {
    parts.push(`class="${c.className.slice(0, 40)}"`);
  }
  if (c.childRefs.length > 0) {
    parts.push(`children=[${c.childRefs.slice(0, 10).join(",")}${c.childRefs.length > 10 ? `+${c.childRefs.length - 10}` : ""}]`);
  }
  parts.push(`preview=${JSON.stringify(c.textPreview)}`);
  return parts.join(" | ");
}

export function buildVisionDetectUserPrompt(
  args: {
    title: string;
    source: string;
    candidates: VisibleRegionCandidate[];
    viewport: { width: number; height: number };
    fullPageHeight: number;
  },
  opts: { devMode?: boolean } = {},
): string {
  const lines: string[] = [
    `Page title: ${args.title || "Untitled page"}`,
    `Source: ${args.source}`,
    `Viewport: ${args.viewport.width}×${args.viewport.height}px (full page height: ${args.fullPageHeight}px)`,
    "",
    "Use the screenshot for visual reasoning (layout, color, separation). Use the candidate list below for stable addressing. Each candidate has a `[ref]` you must use to identify it in your response.",
    "",
    "Candidate format: [ref] | tag[role=...] | bbox=(x,y,WxH) | bg=color | font=size/weight | textLength | linkDensity | aria | class | children=[refs] | preview=\"...\"",
    "",
    "Candidates (ordered by walk order):",
    ...args.candidates.map(serializeVisionCandidate),
    "",
    "Task:",
    "1. Look at the screenshot and identify which areas are visually and semantically distinct content regions.",
    "2. For each region you identify, find the candidate in the list whose bounding box and content best matches that area, and use its `ref`.",
    "3. Apply the five criteria (purpose, value, distinctiveness, non-overlap, atomicity).",
    "4. Surface no more than 6 included regions. Mark useless or redundant candidates with include=false.",
    "5. Provide a specific label, a specific description, confidence (0–1), score (0–100), and a concise rationale for each.",
  ];

  if (opts.devMode) {
    lines.push(
      "6. For every region (included and excluded), populate the `reasoning` object with purpose, importance, nonOverlap, and atomicity fields.",
    );
  }

  return lines.join("\n");
}

/**
 * The convert step is now deterministic (`htmlToMarkdown`); there is no
 * AI authorship of body content. The cleanup step below operates on the
 * already-converted markdown to strip UI cruft and normalize structure.
 *
 * Hard rules embedded in the prompt:
 *   - Never invent content. Output must be a strict subset of input lines
 *     (with optional structural normalization), never a superset.
 *   - Never re-word, re-translate, or paraphrase any retained line.
 *   - Never change link text or URLs.
 *   - Code blocks are sacred — copy verbatim, including whitespace.
 */
export function buildCleanupSystemPrompt(): string {
  return [
    "You are a markdown janitor. You receive markdown that was deterministically converted from a region of a web page, and you return a cleaned version of that same markdown.",
    "",
    "YOUR ONLY JOB IS TO REMOVE OR LIGHTLY RESTRUCTURE. You may NEVER author new content, re-word retained content, summarize, paraphrase, translate, or expand on anything.",
    "",
    "ALLOWED operations:",
    "  • Remove UI cruft lines: 'Was this page helpful?', 'Yes / No', 'Submit feedback', 'Thank you for helping us improve!', 'Edit this page', 'Improve this doc', social share buttons, 'Copy link', 'Print', 'Download PDF'.",
    "  • Remove pagination cruft: 'Previous', 'Next', 'Back to top', breadcrumb trails when they duplicate the page title.",
    "  • Remove cookie/consent disclosures: 'This site uses cookies...', 'Accept all', 'Reject all', 'Cookie preferences'.",
    "  • Remove duplicate consecutive headings (when the H1 and the breadcrumb leaf are the same text, keep the H1 and drop the breadcrumb line).",
    "  • Remove empty headings, empty list items, and runs of 3+ blank lines (collapse to 1 blank line).",
    "  • Normalize heading levels so the document starts at H1 and never skips levels (e.g. H1 → H3 becomes H1 → H2). Only adjust levels if the input is clearly wrong; if the input is consistent, leave it alone.",
    "",
    "FORBIDDEN operations:",
    "  • Adding any sentence, phrase, heading, list item, or word that did not appear in the input.",
    "  • Re-wording, paraphrasing, summarizing, or 'improving' any retained text.",
    "  • Changing the order of content blocks (except removing them).",
    "  • Modifying code blocks in ANY way — copy them verbatim, including all whitespace and language tags.",
    "  • Modifying link URLs or link text.",
    "  • Translating text from one language to another.",
    "  • Inferring or expanding abbreviations (e.g. don't change 'API' to 'Application Programming Interface').",
    "",
    "If you are unsure whether a line is cruft or content, KEEP IT. False negatives (kept cruft) are vastly preferable to false positives (deleted content) or hallucinations (invented content).",
    "",
    "Return strict JSON only with the requested schema.",
  ].join("\n");
}

export function buildCleanupUserPrompt(args: {
  source: string;
  title: string;
  selectedRegionLabel: string;
  markdown: string;
}): string {
  return [
    `Source: ${args.source}`,
    `Page title: ${args.title || "Untitled page"}`,
    `Selected region: ${args.selectedRegionLabel}`,
    "",
    "Clean the markdown below according to your system instructions. Return JSON of the form:",
    '  { "markdown": "<cleaned markdown>", "removedLineCount": <integer>, "warnings": ["..."] }',
    "",
    "`removedLineCount` must equal the number of source lines you dropped (use 0 if you only adjusted heading levels).",
    "",
    "MARKDOWN TO CLEAN:",
    "```markdown",
    args.markdown,
    "```",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy heuristic prompts — retained for paste/tab sources where we cannot
// take a screenshot. The vision flow above is preferred for url/html sources.
// ─────────────────────────────────────────────────────────────────────────────

export function buildLegacyDetectUserPrompt(
  args: { title: string; source: string; candidates: ExtractionRegion[] },
  opts: { devMode?: boolean } = {},
): string {
  const renderedCandidates = args.candidates
    .map((candidate) => {
      return [
        `  id=${candidate.id}`,
        `label="${candidate.label}"`,
        `kind=${candidate.kind}`,
        `textLength=${candidate.textLength}`,
        `linkDensity=${candidate.linkDensity.toFixed(3)}`,
        `heuristicScore=${candidate.score}`,
        `preview=${JSON.stringify(candidate.previewText || "(empty)")}`,
      ].join(" | ");
    })
    .join("\n");

  const lines = [
    `Page title: ${args.title || "Untitled page"}`,
    `Source: ${args.source}`,
    "",
    "Candidate regions (DOM-extracted heuristics — labels and scores are rough starting points):",
    "",
    renderedCandidates,
    "",
    "Task:",
    "1. Apply the five criteria (purpose, value, distinctiveness, non-overlap, atomicity) to each candidate.",
    "2. Assign each region a specific, informative label.",
    "3. Write a specific description (max ~120 chars).",
    "4. Provide confidence (0–1) and score (0–100).",
    "5. Write a concise rationale.",
    "6. Set include=false for regions that are low-value, redundant, or whose better sub-regions are present.",
  ];

  if (opts.devMode) {
    lines.push(
      "7. For every region, populate the `reasoning` object with purpose, importance, nonOverlap, and atomicity fields.",
    );
  }

  return lines.join("\n");
}
