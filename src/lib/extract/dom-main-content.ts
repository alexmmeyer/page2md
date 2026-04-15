import type { ExtractionRegion, ExtractionRegionKind } from "../types/conversion";

/**
 * Browser-only extraction for the Chrome extension. Keep aligned with `extract-page.ts`
 * `page.evaluate` when changing selectors or extraction behavior.
 */

export interface DomExtractedContent {
  title: string;
  html: string;
  regions: ExtractionRegion[];
  defaultRegionId?: string;
  selectedRegionId?: string;
  selectedRegionLabel?: string;
  report: {
    collapsiblesAttempted: number;
    collapsiblesOpened: number;
    sequentialGroupsDetected: number;
    warnings: string[];
  };
}

export async function extractDomMainContent(
  mainContentOnly: boolean,
  selectedRegionId?: string,
): Promise<DomExtractedContent> {
  const MAIN_CANDIDATE_SELECTORS = [
    "main",
    "article",
    "[role='main']",
    "#content",
    ".content",
    ".main-content",
    ".markdown-body",
    ".docs-content",
    "#__docusaurus",
    ".theme-doc-markdown",
    ".markdown-section",
    "#swagger-ui",
    ".swagger-ui",
    ".swagger-ui-wrap",
    ".redoc-wrap",
    "redoc",
    ".rm-Article",
    ".rm-Markdown",
    ".api-content",
    ".reference-content",
    "[class*='reference-layout']",
    "[class*='DocPage']",
  ];
  const REGION_CANDIDATE_SELECTORS = [
    ...MAIN_CANDIDATE_SELECTORS,
    "header",
    "footer",
    "nav",
    "aside",
    "section",
    "[role='navigation']",
    "[role='complementary']",
    "[role='region']",
    ".toc",
    ".table-of-contents",
    "[aria-label*='table of contents' i]",
    "[aria-label*='on this page' i]",
    "[class*='sidebar']",
    "[class*='SideBar']",
  ];

  const EXCLUDED_SELECTORS = [
    "script",
    "style",
    "noscript",
    "nav",
    "aside",
    "header",
    "footer",
    "[role='navigation']",
    ".toc",
    ".table-of-contents",
    "[class*='sidebar']",
    "[class*='SideBar']",
    "[aria-label*='table of contents' i]",
    "[aria-label*='on this page' i]",
  ];

  const warnings: string[] = [];
  let collapsiblesAttempted = 0;
  let collapsiblesOpened = 0;
  let sequentialGroupsDetected = 0;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const dedupeSpaces = (value: string) => value.replace(/\s+/g, " ").trim();
  const toTitleCase = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const hashString = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  };
  const domFingerprint = (element: HTMLElement) => {
    const parts: string[] = [];
    let node: HTMLElement | null = element;
    let depth = 0;
    while (node && depth < 6 && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      const idPart = node.id ? `#${node.id}` : "";
      const classPart = (node.className || "")
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      const siblingIndex = node.parentElement
        ? Array.from(node.parentElement.children)
            .filter((child) => (child as HTMLElement).tagName === node?.tagName)
            .indexOf(node) + 1
        : 1;
      parts.push(`${tag}${idPart}${classPart ? `.${classPart}` : ""}:nth${siblingIndex}`);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(">");
  };
  const classifyKind = (element: HTMLElement): ExtractionRegionKind => {
    const tag = element.tagName.toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();
    const aria = (
      element.getAttribute("aria-label") ||
      element.getAttribute("aria-labelledby") ||
      ""
    ).toLowerCase();
    const hint = `${tag} ${role} ${aria} ${element.id} ${element.className}`.toLowerCase();
    if (
      hint.includes("table of contents") ||
      hint.includes("on this page") ||
      hint.includes("toc")
    ) {
      return "toc";
    }
    if (tag === "nav" || role === "navigation" || hint.includes("nav") || hint.includes("menu")) {
      return "navigation";
    }
    if (tag === "header") {
      return "header";
    }
    if (tag === "footer") {
      return "footer";
    }
    if (
      tag === "aside" ||
      role === "complementary" ||
      hint.includes("sidebar") ||
      hint.includes("rail")
    ) {
      return "sidebar";
    }
    if (tag === "main" || role === "main") {
      return "main";
    }
    if (tag === "article") {
      return "article";
    }
    if (hint.includes("content") || hint.includes("docs") || hint.includes("reference")) {
      return "content";
    }
    return "section";
  };
  const labelForKind = (kind: ExtractionRegionKind): string => {
    if (kind === "main") {
      return "Main content";
    }
    if (kind === "article") {
      return "Article";
    }
    if (kind === "content") {
      return "Content";
    }
    if (kind === "navigation") {
      return "Navigation";
    }
    if (kind === "header") {
      return "Header";
    }
    if (kind === "footer") {
      return "Footer";
    }
    if (kind === "sidebar") {
      return "Sidebar";
    }
    if (kind === "toc") {
      return "On this page";
    }
    return "Section";
  };

  const mainCandidates = MAIN_CANDIDATE_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  ).filter(Boolean);

  const uniqCandidates = Array.from(new Set(mainCandidates));
  const bodyCandidate = document.body;
  if (uniqCandidates.length === 0) {
    uniqCandidates.push(bodyCandidate);
  }

  const scoreElement = (el: HTMLElement) => {
    const text = (el.innerText || "").trim();
    const textLength = text.length;
    const linkCount = el.querySelectorAll("a").length;
    const nodeCount = el.querySelectorAll("*").length || 1;
    const linkDensity = linkCount / nodeCount;
    const area = el.clientHeight * el.clientWidth;
    return textLength + Math.min(area / 1000, 2_000) - linkDensity * 1_500;
  };

  const mainElement = uniqCandidates.sort((a, b) => scoreElement(b) - scoreElement(a))[0];
  const detectionRoot = mainContentOnly ? mainElement : document.body;
  const regionCandidates = REGION_CANDIDATE_SELECTORS.flatMap((selector) =>
    Array.from(detectionRoot.querySelectorAll<HTMLElement>(selector)),
  );
  regionCandidates.push(detectionRoot);
  const uniqueRegionCandidates = Array.from(new Set(regionCandidates)).filter(
    (element): element is HTMLElement => Boolean(element),
  );

  type RegionCandidate = {
    element: HTMLElement;
    kind: ExtractionRegionKind;
    label: string;
    textLength: number;
    linkDensity: number;
    score: number;
    id: string;
  };
  const scoredRegionCandidates: RegionCandidate[] = uniqueRegionCandidates
    .map((element) => {
      const text = dedupeSpaces(element.innerText || "");
      const textLength = text.length;
      if (textLength < 80) {
        return null;
      }
      const linkCount = element.querySelectorAll("a").length;
      const nodeCount = element.querySelectorAll("*").length || 1;
      const linkDensity = linkCount / nodeCount;
      const area = element.clientHeight * element.clientWidth;
      const kind = classifyKind(element);
      const kindBonus: Record<ExtractionRegionKind, number> = {
        main: 900,
        article: 700,
        content: 500,
        section: 250,
        navigation: -250,
        header: -300,
        footer: -300,
        sidebar: -220,
        toc: -480,
      };
      const score =
        textLength + Math.min(area / 1500, 1_600) - linkDensity * 1_300 + (kindBonus[kind] ?? 0);
      const rawAria = dedupeSpaces(element.getAttribute("aria-label") || "");
      const label = rawAria && rawAria.length <= 40 ? toTitleCase(rawAria) : labelForKind(kind);
      const id = `region-${kind}-${hashString(domFingerprint(element)).toString(36)}`;
      return {
        element,
        kind,
        label,
        textLength,
        linkDensity,
        score,
        id,
      };
    })
    .filter((candidate): candidate is RegionCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  const dedupedRegionCandidates: RegionCandidate[] = [];
  for (const candidate of scoredRegionCandidates) {
    const isNearDuplicate = dedupedRegionCandidates.some((existing) => {
      const existingContainsCandidate = existing.element.contains(candidate.element);
      const candidateContainsExisting = candidate.element.contains(existing.element);
      if (!existingContainsCandidate && !candidateContainsExisting) {
        return false;
      }
      const bigger = Math.max(existing.textLength, candidate.textLength);
      const smaller = Math.min(existing.textLength, candidate.textLength);
      return smaller / bigger > 0.9;
    });
    if (!isNearDuplicate) {
      dedupedRegionCandidates.push(candidate);
    }
    if (dedupedRegionCandidates.length >= 8) {
      break;
    }
  }
  if (dedupedRegionCandidates.length === 0) {
    const fallbackKind = classifyKind(detectionRoot);
    dedupedRegionCandidates.push({
      element: detectionRoot,
      kind: fallbackKind,
      label: labelForKind(fallbackKind),
      textLength: dedupeSpaces(detectionRoot.innerText || "").length,
      linkDensity: 0,
      score: scoreElement(detectionRoot),
      id: `region-${fallbackKind}-${hashString(domFingerprint(detectionRoot)).toString(36)}`,
    });
  }

  const labelCounts = new Map<string, number>();
  const idCounts = new Map<string, number>();
  const normalizedRegionCandidates = dedupedRegionCandidates.map((candidate) => {
    const labelCount = (labelCounts.get(candidate.label) ?? 0) + 1;
    labelCounts.set(candidate.label, labelCount);
    const normalizedLabel = labelCount > 1 ? `${candidate.label} ${labelCount}` : candidate.label;

    const idCount = (idCounts.get(candidate.id) ?? 0) + 1;
    idCounts.set(candidate.id, idCount);
    const normalizedId = idCount > 1 ? `${candidate.id}-${idCount}` : candidate.id;

    return { ...candidate, label: normalizedLabel, id: normalizedId };
  });

  const preferredCandidate = normalizedRegionCandidates
    .filter((candidate) => !["navigation", "header", "footer", "sidebar", "toc"].includes(candidate.kind))
    .sort((a, b) => b.score - a.score)[0];
  const defaultCandidate =
    preferredCandidate ??
    normalizedRegionCandidates.slice().sort((a, b) => b.score - a.score)[0] ??
    null;
  const selectedCandidate =
    normalizedRegionCandidates.find((candidate) => candidate.id === selectedRegionId) ??
    defaultCandidate;
  const defaultRegionId = defaultCandidate?.id;
  const finalSelectedRegionId = selectedCandidate?.id;
  if (selectedRegionId && !selectedCandidate) {
    warnings.push("Selected region no longer matched the page; default region was used.");
  }
  const scopeElement = selectedCandidate?.element ?? detectionRoot;
  const isIncludedInOutput = (element: Element) =>
    !EXCLUDED_SELECTORS.some((selector) => element.closest(selector));

  const iframeCount = document.querySelectorAll("iframe").length;
  if (iframeCount > 0) {
    warnings.push(
      `${iframeCount} iframe(s) detected; cross-origin frame content may be skipped.`,
    );
  }

  const detailsNodes = Array.from(
    scopeElement.querySelectorAll<HTMLDetailsElement>("details"),
  ).filter((details) => isIncludedInOutput(details));
  for (const details of detailsNodes) {
    collapsiblesAttempted += 1;
    if (!details.open) {
      details.open = true;
    }
    collapsiblesOpened += 1;
  }

  const buttons = Array.from(
    scopeElement.querySelectorAll<HTMLElement>("button, [role='button'], [role='tab']"),
  ).filter((el) => {
    if (!isIncludedInOutput(el)) {
      return false;
    }
    const text = (el.textContent || "").toLowerCase();
    const expanded = el.getAttribute("aria-expanded");
    const isBulkToggle = text.includes("expand all") || text.includes("collapse all");
    return (
      !isBulkToggle &&
      (expanded === "false" ||
        expanded === "true" ||
        text.includes("show more") ||
        text.includes("expand") ||
        text.includes("open"))
    );
  });
  const uniqueButtons = Array.from(new Set(buttons));

  const parentToButtons = new Map<HTMLElement, HTMLElement[]>();
  for (const btn of uniqueButtons) {
    const parent = btn.parentElement;
    if (!parent) {
      continue;
    }
    const list = parentToButtons.get(parent) ?? [];
    list.push(btn);
    parentToButtons.set(parent, list);
  }

  const groupedButtons = Array.from(parentToButtons.entries()).filter(
    ([, groupButtons]) => groupButtons.length > 1,
  );
  sequentialGroupsDetected = groupedButtons.length;
  const groupedButtonSet = new Set(groupedButtons.flatMap(([, group]) => group));

  const countButtonExpansion = async (btn: HTMLElement) => {
    collapsiblesAttempted += 1;
    const expandedState = btn.getAttribute("aria-expanded");
    if (expandedState === "true") {
      collapsiblesOpened += 1;
      return;
    }

    try {
      btn.click();
      await sleep(70);
      collapsiblesOpened += 1;
    } catch {
      // Ignore click failures and continue with best-effort extraction.
    }
  };

  for (const [, groupButtons] of groupedButtons) {
    for (const btn of groupButtons) {
      await countButtonExpansion(btn);
    }
  }

  for (const btn of uniqueButtons) {
    if (groupedButtonSet.has(btn)) {
      continue;
    }
    await countButtonExpansion(btn);
  }

  const stripExcluded = (root: HTMLElement): string => {
    const cloneLocal = root.cloneNode(true) as HTMLElement;
    for (const selector of EXCLUDED_SELECTORS) {
      const found = cloneLocal.querySelectorAll(selector);
      for (const node of found) {
        node.remove();
      }
    }
    return cloneLocal.innerHTML;
  };

  const html = stripExcluded(scopeElement);
  const regions: ExtractionRegion[] = normalizedRegionCandidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    textLength: candidate.textLength,
    linkDensity: candidate.linkDensity,
    score: Math.round(candidate.score),
  }));

  return {
    title: document.title || "Untitled Page",
    html,
    regions,
    defaultRegionId,
    selectedRegionId: finalSelectedRegionId,
    selectedRegionLabel: selectedCandidate?.label,
    report: {
      collapsiblesAttempted,
      collapsiblesOpened,
      sequentialGroupsDetected,
      warnings,
    },
  };
}
