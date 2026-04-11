import sparticuzChromium from "@sparticuz/chromium";
import { chromium, type Browser } from "playwright-core";

import type { DomExtractedContent } from "./dom-main-content";

type ExtractedContent = DomExtractedContent;

type ExtractOptions = {
  sourceType: "url" | "html";
  source: string;
  mainContentOnly: boolean;
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
}: ExtractOptions): Promise<ExtractedContent> {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    if (sourceType === "url") {
      await page.goto(source, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
    } else {
      await page.setContent(source, { waitUntil: "networkidle" });
    }

    const result = await page.evaluate(
      async ({ candidateSelectors, excludedSelectors, mainOnly }) => {
        const warnings: string[] = [];
        let collapsiblesAttempted = 0;
        let collapsiblesOpened = 0;
        let sequentialGroupsDetected = 0;

        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

        const mainElement = uniqCandidates.sort(
          (a, b) => scoreElement(b) - scoreElement(a),
        )[0];
        const scopeElement = mainOnly ? mainElement : document.body;
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

        const buttons = Array.from(
          scopeElement.querySelectorAll<HTMLElement>(
            "button, [role='button'], [role='tab']",
          ),
        ).filter((el) => {
          if (!isIncludedInOutput(el)) {
            return false;
          }
          const text = (el.textContent || "").toLowerCase();
          const expanded = el.getAttribute("aria-expanded");
          const isBulkToggle =
            text.includes("expand all") || text.includes("collapse all");
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
          for (const selector of excludedSelectors) {
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
      },
      {
        candidateSelectors: MAIN_CANDIDATE_SELECTORS,
        excludedSelectors: EXCLUDED_SELECTORS,
        mainOnly: mainContentOnly,
      },
    );

    return result;
  } finally {
    await page.close();
    await browser.close();
  }
}
