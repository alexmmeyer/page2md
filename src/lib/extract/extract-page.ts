import { chromium } from "playwright";

interface ExtractedContent {
  title: string;
  html: string;
  report: {
    collapsiblesAttempted: number;
    collapsiblesOpened: number;
    sequentialGroupsDetected: number;
    warnings: string[];
  };
}

const MAIN_CANDIDATE_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  "#content",
  ".content",
  ".main-content",
  ".markdown-body",
  ".docs-content",
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

type ExtractOptions = {
  sourceType: "url" | "html";
  source: string;
  mainContentOnly: boolean;
};

export async function extractPageContent({
  sourceType,
  source,
  mainContentOnly,
}: ExtractOptions): Promise<ExtractedContent> {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Playwright launch error";
    const looksLikeMissingBinary =
      typeof message === "string" &&
      (message.includes("Executable doesn't exist") ||
        message.includes("Please run the following command to download new browsers"));

    if (looksLikeMissingBinary) {
      try {
        browser = await chromium.launch({ headless: true, channel: "chrome" });
      } catch (chromeError) {
        const chromeMessage =
          chromeError instanceof Error ? chromeError.message : "Unknown Chrome fallback error";
        throw new Error(
          `Playwright Chromium is unavailable and Chrome fallback failed. Install bundled browser with "npx playwright install chromium" or ensure Google Chrome is installed. (chromium: ${message}) (chrome fallback: ${chromeMessage})`,
        );
      }
    } else {
      throw new Error(`Playwright launch failed: ${message}`);
    }
  }
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

        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));

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
          // Already-open and newly-open details both count as opened for users.
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

        const targetElement = scopeElement;
        const clone = targetElement.cloneNode(true) as HTMLElement;

        for (const selector of excludedSelectors) {
          const found = clone.querySelectorAll(selector);
          for (const node of found) {
            node.remove();
          }
        }

        return {
          title: document.title || "Untitled Page",
          html: clone.innerHTML,
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

