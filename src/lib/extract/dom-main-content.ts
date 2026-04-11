/**
 * Browser-only extraction for the Chrome extension. Keep aligned with `extract-page.ts`
 * `page.evaluate` when changing selectors or extraction behavior.
 */

export interface DomExtractedContent {
  title: string;
  html: string;
  report: {
    collapsiblesAttempted: number;
    collapsiblesOpened: number;
    sequentialGroupsDetected: number;
    warnings: string[];
  };
}

export async function extractDomMainContent(mainContentOnly: boolean): Promise<DomExtractedContent> {
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
  const scopeElement = mainContentOnly ? mainElement : document.body;
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

  let html = stripExcluded(scopeElement);
  const MIN_MEANINGFUL_HTML = 120;
  if (html.trim().length < MIN_MEANINGFUL_HTML && document.body) {
    const bodyHtml = stripExcluded(document.body);
    if (bodyHtml.trim().length > html.trim().length) {
      html = bodyHtml;
      warnings.push(
        "Main content region was very short; used a broader slice of the page (extra chrome may appear).",
      );
    }
  }

  return {
    title: document.title || "Untitled Page",
    html,
    report: {
      collapsiblesAttempted,
      collapsiblesOpened,
      sequentialGroupsDetected,
      warnings,
    },
  };
}
