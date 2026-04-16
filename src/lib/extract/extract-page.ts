import sparticuzChromium from "@sparticuz/chromium";
import { chromium, type Browser } from "playwright-core";

import type { DomExtractedContent } from "./dom-main-content";

type ExtractedContent = DomExtractedContent;

type ExtractOptions = {
  sourceType: "url" | "html";
  source: string;
  mainContentOnly: boolean;
  selectedRegionId?: string;
};

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

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL === "1") {
    sparticuzChromium.setGraphicsMode = false;
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }

  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Playwright launch error";
    const looksLikeMissingBinary =
      typeof message === "string" &&
      (message.includes("Executable doesn't exist") ||
        message.includes("Please run the following command to download new browsers"));

    if (looksLikeMissingBinary) {
      try {
        return await chromium.launch({ headless: true, channel: "chrome" });
      } catch (chromeError) {
        const chromeMessage =
          chromeError instanceof Error ? chromeError.message : "Unknown Chrome fallback error";
        throw new Error(
          `Playwright Chromium is unavailable and Chrome fallback failed. Install bundled browser with "npx playwright install chromium" or ensure Google Chrome is installed. (chromium: ${message}) (chrome fallback: ${chromeMessage})`,
        );
      }
    }
    throw new Error(`Playwright launch failed: ${message}`);
  }
}

/** Keep `page.evaluate` body aligned with `dom-main-content.ts` (Chrome extension). */
export async function extractPageContent({
  sourceType,
  source,
  mainContentOnly,
  selectedRegionId,
}: ExtractOptions): Promise<ExtractedContent> {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    if (sourceType === "url") {
      await page.goto(source, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(1_500);
    } else {
      await page.setContent(source, { waitUntil: "domcontentloaded" });
    }

    const result = await page.evaluate(
      async ({ candidateSelectors, regionCandidateSelectors, excludedSelectors, mainOnly, regionId }) => {
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
        const classifyKind = (
          element: HTMLElement,
        ): "main" | "article" | "content" | "navigation" | "header" | "footer" | "sidebar" | "toc" | "section" => {
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
        const labelForKind = (
          kind: "main" | "article" | "content" | "navigation" | "header" | "footer" | "sidebar" | "toc" | "section",
        ): string => {
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
        const previewTextFor = (value: string) => {
          const compact = dedupeSpaces(value);
          if (!compact) {
            return "";
          }
          const sentences = compact
            .split(/(?<=[.?!])\s+/)
            .map((part) => part.trim())
            .filter(Boolean);
          const merged = sentences.slice(0, 2).join(" ");
          const candidate = merged || compact;
          return candidate.length > 180 ? `${candidate.slice(0, 177)}...` : candidate;
        };

        const mainCandidates = candidateSelectors
          .flatMap((selector) =>
            Array.from(document.querySelectorAll<HTMLElement>(selector)),
          )
          .filter(Boolean);

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
        const detectionRoot = mainOnly ? mainElement : document.body;
        const regionCandidates = regionCandidateSelectors
          .flatMap((selector) => Array.from(detectionRoot.querySelectorAll<HTMLElement>(selector)))
          .filter(Boolean);
        regionCandidates.push(detectionRoot);
        const uniqueRegionCandidates = Array.from(new Set(regionCandidates));

        type RegionCandidate = {
          element: HTMLElement;
          kind: "main" | "article" | "content" | "navigation" | "header" | "footer" | "sidebar" | "toc" | "section";
          label: string;
          previewText: string;
          textLength: number;
          linkDensity: number;
          score: number;
          id: string;
        };
        const CANDIDATE_LIMIT = 8;
        const PRESERVE_KINDS: RegionCandidate["kind"][] = ["toc", "navigation", "sidebar"];
        const scoredRegionCandidates: RegionCandidate[] = uniqueRegionCandidates
          .map((element) => {
            const text = dedupeSpaces(element.innerText || "");
            const textLength = text.length;
            const kind = classifyKind(element);
            const minTextLengthByKind: Record<RegionCandidate["kind"], number> = {
              main: 140,
              article: 120,
              content: 100,
              section: 90,
              navigation: 40,
              header: 30,
              footer: 30,
              sidebar: 40,
              toc: 30,
            };
            if (textLength < minTextLengthByKind[kind]) {
              return null;
            }
            const linkCount = element.querySelectorAll("a").length;
            const nodeCount = element.querySelectorAll("*").length || 1;
            const linkDensity = linkCount / nodeCount;
            const area = element.clientHeight * element.clientWidth;
            const kindBonus: Record<RegionCandidate["kind"], number> = {
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
            const isStructuralKind = ["navigation", "header", "footer", "sidebar", "toc"].includes(kind);
            const appearsToWrapMainContent =
              element === detectionRoot ||
              element.contains(mainElement) ||
              element.querySelector("main, article, [role='main']") !== null;
            const structuralContainPenalty =
              isStructuralKind && appearsToWrapMainContent ? textLength * 0.18 : 0;
            const score =
              textLength +
              Math.min(area / 1500, 1_600) -
              linkDensity * 1_300 +
              (kindBonus[kind] ?? 0) -
              structuralContainPenalty;
            const rawAria = dedupeSpaces(element.getAttribute("aria-label") || "");
            const label = rawAria && rawAria.length <= 40 ? toTitleCase(rawAria) : labelForKind(kind);
            const id = `region-${kind}-${hashString(domFingerprint(element)).toString(36)}`;
            return {
              element,
              kind,
              label,
              previewText: previewTextFor(text),
              textLength,
              linkDensity,
              score,
              id,
            };
          })
          .filter((candidate): candidate is RegionCandidate => Boolean(candidate))
          .sort((a, b) => b.score - a.score);

        const contentKinds = new Set<RegionCandidate["kind"]>(["main", "article", "content", "section"]);
        const qualityRank = (candidate: RegionCandidate) => {
          const kindPriority: Record<RegionCandidate["kind"], number> = {
            article: 5,
            main: 4,
            content: 3,
            section: 2,
            toc: 5,
            sidebar: 4,
            navigation: 3,
            header: 2,
            footer: 2,
          };
          return candidate.score + (kindPriority[candidate.kind] ?? 0) * 180 - candidate.linkDensity * 300;
        };
        const dedupedRegionCandidates: RegionCandidate[] = [];
        for (const candidate of scoredRegionCandidates) {
          const overlappingIndex = dedupedRegionCandidates.findIndex((existing) => {
            const existingContainsCandidate = existing.element.contains(candidate.element);
            const candidateContainsExisting = candidate.element.contains(existing.element);
            if (!existingContainsCandidate && !candidateContainsExisting) {
              return false;
            }
            const bigger = Math.max(existing.textLength, candidate.textLength);
            const smaller = Math.min(existing.textLength, candidate.textLength);
            const overlapRatio = smaller / bigger;
            if (overlapRatio > 0.9) {
              return true;
            }
            const bothContentLike = contentKinds.has(existing.kind) && contentKinds.has(candidate.kind);
            return bothContentLike && overlapRatio > 0.58;
          });
          if (overlappingIndex === -1) {
            dedupedRegionCandidates.push(candidate);
          } else if (qualityRank(candidate) > qualityRank(dedupedRegionCandidates[overlappingIndex])) {
            dedupedRegionCandidates[overlappingIndex] = candidate;
          }
        }
        if (dedupedRegionCandidates.length === 0) {
          const fallbackKind = classifyKind(detectionRoot);
          dedupedRegionCandidates.push({
            element: detectionRoot,
            kind: fallbackKind,
            label: labelForKind(fallbackKind),
            previewText: previewTextFor(dedupeSpaces(detectionRoot.innerText || "")),
            textLength: dedupeSpaces(detectionRoot.innerText || "").length,
            linkDensity: 0,
            score: scoreElement(detectionRoot),
            id: `region-${fallbackKind}-${hashString(domFingerprint(detectionRoot)).toString(36)}`,
          });
        }

        const byScore = dedupedRegionCandidates.slice().sort((a, b) => b.score - a.score);
        const selectedIds = new Set<string>();
        const boundedRegionCandidates: RegionCandidate[] = [];
        for (const kind of PRESERVE_KINDS) {
          const match = byScore.find((candidate) => candidate.kind === kind);
          if (!match || selectedIds.has(match.id)) {
            continue;
          }
          boundedRegionCandidates.push(match);
          selectedIds.add(match.id);
        }
        for (const candidate of byScore) {
          if (selectedIds.has(candidate.id)) {
            continue;
          }
          boundedRegionCandidates.push(candidate);
          selectedIds.add(candidate.id);
          if (boundedRegionCandidates.length >= CANDIDATE_LIMIT) {
            break;
          }
        }

        const labelCounts = new Map<string, number>();
        const idCounts = new Map<string, number>();
        const normalizedRegionCandidates = boundedRegionCandidates.map((candidate) => {
          const labelCount = (labelCounts.get(candidate.label) ?? 0) + 1;
          labelCounts.set(candidate.label, labelCount);
          const normalizedLabel =
            labelCount > 1 ? `${candidate.label} ${labelCount}` : candidate.label;

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
          normalizedRegionCandidates.find((candidate) => candidate.id === regionId) ?? defaultCandidate;
        if (regionId && !selectedCandidate) {
          warnings.push("Selected region no longer matched the page; default region was used.");
        }
        const scopeElement = selectedCandidate?.element ?? detectionRoot;
        const defaultRegionId = defaultCandidate?.id;
        const selectedRegionId = selectedCandidate?.id;
        const isIncludedInOutput = (element: Element) =>
          !excludedSelectors.some((selector) => element.closest(selector));

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

        const expandTextHints = [
          "show more",
          "expand",
          "open section",
          "open details",
          "read more",
          "view more",
          "see more",
        ];
        const blockedTextHints = [
          "loom",
          "record",
          "camera",
          "video",
          "screen",
          "share",
          "feedback",
          "support",
          "help",
          "chat",
          "assistant",
        ];
        const buttons = Array.from(
          scopeElement.querySelectorAll<HTMLElement>("button, [role='button'], [role='tab']"),
        ).filter((el) => {
          if (!isIncludedInOutput(el)) {
            return false;
          }
          if (
            el.closest("[role='toolbar']") ||
            el.closest("[class*='action']") ||
            el.closest("[class*='floating']") ||
            el.closest("[class*='Loom']")
          ) {
            return false;
          }

          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          const isFloatingSmallControl =
            (style.position === "fixed" || style.position === "sticky") &&
            rect.width <= 260 &&
            rect.height <= 260;
          if (isFloatingSmallControl || area < 500) {
            return false;
          }

          const semanticText = dedupeSpaces(
            `${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`,
          ).toLowerCase();
          if (blockedTextHints.some((hint) => semanticText.includes(hint))) {
            return false;
          }

          const expanded = el.getAttribute("aria-expanded");
          const ariaControls = dedupeSpaces(el.getAttribute("aria-controls") || "");
          const attrHints = dedupeSpaces(
            `${el.id} ${el.className} ${el.getAttribute("data-testid") || ""} ${el.getAttribute("data-qa") || ""}`,
          ).toLowerCase();
          const hasExpandText = expandTextHints.some((hint) => semanticText.includes(hint));
          const hasAccordionHint = /accordion|collapse|expand|disclosure|toggle|details|section|faq/.test(
            attrHints,
          );
          const isBulkToggle =
            semanticText.includes("expand all") || semanticText.includes("collapse all");
          if (isBulkToggle) {
            return false;
          }
          return expanded === "false" || hasExpandText || hasAccordionHint || ariaControls.length > 0;
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
          for (const selector of excludedSelectors) {
            const found = cloneLocal.querySelectorAll(selector);
            for (const node of found) {
              node.remove();
            }
          }
          return cloneLocal.innerHTML;
        };

        const html = stripExcluded(scopeElement);
        const regions = normalizedRegionCandidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          previewText: candidate.previewText,
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
          selectedRegionId,
          selectedRegionLabel: selectedCandidate?.label,
          report: {
            collapsiblesAttempted,
            collapsiblesOpened,
            sequentialGroupsDetected,
            warnings,
          },
        };
      },
      {
        candidateSelectors: MAIN_CANDIDATE_SELECTORS,
        regionCandidateSelectors: [
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
        ],
        excludedSelectors: EXCLUDED_SELECTORS,
        mainOnly: mainContentOnly,
        regionId: selectedRegionId,
      },
    );

    return result;
  } finally {
    await page.close();
    await browser.close();
  }
}
