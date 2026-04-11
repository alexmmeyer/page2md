import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import { markdownWithYamlFrontmatter } from "@/lib/convert/markdown-frontmatter";
import {
  extractDomMainContent,
  type DomExtractedContent,
} from "@/lib/extract/dom-main-content";
import type { ConversionMeta, ConversionSourceType, ExtractionReport } from "@/lib/types/conversion";
import {
  SHARED_HISTORY_MAX_ITEMS,
  SHARED_HISTORY_STORAGE_KEY,
  normalizeSharedHistoryState,
  type SharedHistoryState,
  type SharedHistoryItem,
} from "@/lib/history/shared-history";

import { highlightJsonForPreview, highlightMarkdownForPreview } from "./markdown-highlight";

const TRASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

type ExtensionHistoryItem = SharedHistoryItem;
type PreviewFormat = "markdown" | "json";
type PersistedState = SharedHistoryState;

function stripFrontmatter(markdownText: string): string {
  if (!markdownText.startsWith("---\n")) {
    return markdownText;
  }
  const end = markdownText.indexOf("\n---\n", 4);
  if (end === -1) {
    return markdownText;
  }
  return markdownText.slice(end + 5);
}

function firstHeadingFromMarkdown(markdownText: string): string {
  const withoutFrontmatter = stripFrontmatter(markdownText);
  for (const line of withoutFrontmatter.split("\n")) {
    const match = line.match(/^#{1,2}\s+(.+)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function sanitizeFileStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function dedupeRepeatedStem(stem: string): string {
  const parts = stem.split("-").filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) {
    return stem;
  }
  const half = parts.length / 2;
  const firstHalf = parts.slice(0, half);
  const secondHalf = parts.slice(half);
  const isExactRepeat = firstHalf.every((value, index) => value === secondHalf[index]);
  return isExactRepeat ? firstHalf.join("-") : stem;
}

function conversionPreview(markdownText: string): string {
  const withoutFrontmatter = stripFrontmatter(markdownText);
  const lines = withoutFrontmatter
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"));
  return lines.slice(0, 2).join(" ").slice(0, 220);
}

function plainTitle(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestFrameResult(
  results: chrome.scripting.InjectionResult<DomExtractedContent>[],
): DomExtractedContent | undefined {
  const candidates = results
    .map((entry) => entry.result)
    .filter((r): r is DomExtractedContent => Boolean(r && typeof r.html === "string" && r.html.trim().length > 0));
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.reduce((best, cur) =>
    cur.html.length > best.html.length ? cur : best,
  );
}

function canScriptTab(url: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!url) {
    return { ok: false, reason: "No URL for this tab." };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome:" || parsed.protocol === "chrome-extension:") {
      return { ok: false, reason: "This page cannot be scripted (browser or extension URL)." };
    }
    if (parsed.protocol === "edge:" || parsed.protocol === "about:") {
      return { ok: false, reason: "This page cannot be scripted." };
    }
    if (parsed.hostname === "chrome.google.com") {
      return { ok: false, reason: "Chrome Web Store pages cannot be scripted." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Invalid tab URL." };
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceTypeLabel(sourceType: ExtensionHistoryItem["sourceType"]): string {
  if (sourceType === "url") {
    return "URL";
  }
  if (sourceType === "html") {
    return "HTML";
  }
  if (sourceType === "tab") {
    return "Tab";
  }
  return "Paste";
}

function outputFormatLabel(outputFormat: ExtensionHistoryItem["outputFormat"]): string {
  return outputFormat === "json" ? ".json" : ".md";
}

async function loadState(): Promise<PersistedState> {
  const raw = await chrome.storage.local.get(SHARED_HISTORY_STORAGE_KEY);
  const normalized = normalizeSharedHistoryState(raw[SHARED_HISTORY_STORAGE_KEY]);
  return {
    items: normalized.items,
    activeId: normalized.activeId,
    revision: normalized.revision,
  };
}

async function saveState(state: PersistedState): Promise<void> {
  const nextState: PersistedState = {
    ...state,
    revision: state.revision + 1,
  };
  await chrome.storage.local.set({ [SHARED_HISTORY_STORAGE_KEY]: nextState });
  state.revision = nextState.revision;
}

const el = {
  error: document.getElementById("error") as HTMLParagraphElement,
  convertBtn: document.getElementById("convertBtn") as HTMLButtonElement,
  copyBtn: document.getElementById("copyBtn") as HTMLButtonElement,
  downloadBtn: document.getElementById("downloadBtn") as HTMLButtonElement,
  report: document.getElementById("report") as HTMLElement,
  reportHeading: document.getElementById("reportHeading") as HTMLElement,
  reportCounts: document.getElementById("reportCounts") as HTMLUListElement,
  reportNotesHeading: document.getElementById("reportNotesHeading") as HTMLElement,
  reportWarnings: document.getElementById("reportWarnings") as HTMLElement,
  preview: document.getElementById("preview") as HTMLDivElement,
  tabConvert: document.getElementById("tab-convert") as HTMLButtonElement,
  tabHistory: document.getElementById("tab-history") as HTMLButtonElement,
  panelConvert: document.getElementById("panel-convert") as HTMLElement,
  panelHistory: document.getElementById("panel-history") as HTMLElement,
  historySearch: document.getElementById("historySearch") as HTMLInputElement,
  clearHistoryBtn: document.getElementById("clearHistoryBtn") as HTMLButtonElement,
  historyEmpty: document.getElementById("historyEmpty") as HTMLElement,
  historyList: document.getElementById("historyList") as HTMLElement,
};

let state: PersistedState = { items: [], activeId: null, revision: 0 };
/** Plain markdown for copy/download and highlighting (mirrors web app Prism preview). */
let previewPlain = "";
let previewFormat: PreviewFormat = "markdown";
let currentReport: ExtractionReport | null = null;
let currentSourceType: ConversionSourceType | null = null;

function compactJsonHistoryPreview(item: ExtensionHistoryItem): string {
  if (!item.json) {
    return item.preview || "(No preview text available)";
  }
  const contentSnippet = item.json.markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 170);
  const parts = [
    item.json.meta?.title ? `title: ${item.json.meta.title}` : "",
    contentSnippet ? `content: ${contentSnippet}` : "",
  ].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  const compact = JSON.stringify(item.json);
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function historyPreviewText(item: ExtensionHistoryItem): string {
  if (item.outputFormat === "json") {
    return compactJsonHistoryPreview(item);
  }
  return item.preview || "(No preview text available)";
}

function historyOutput(item: ExtensionHistoryItem): { format: PreviewFormat; text: string } {
  if (item.outputFormat === "json" && item.json) {
    return { format: "json", text: JSON.stringify(item.json, null, 2) };
  }
  return {
    format: "markdown",
    text: item.markdown ?? item.json?.markdown ?? "",
  };
}

function renderPreviewOutput() {
  if (!previewPlain.trim()) {
    el.preview.innerHTML = "";
    el.preview.classList.add("previewArea--empty");
    return;
  }
  el.preview.classList.remove("previewArea--empty");
  if (previewFormat === "markdown") {
    const inner = highlightMarkdownForPreview(previewPlain);
    el.preview.innerHTML = `<pre class="previewPre"><code class="language-markdown">${inner}</code></pre>`;
    return;
  }
  const inner = highlightJsonForPreview(previewPlain);
  el.preview.innerHTML = `<pre class="previewPre"><code class="language-json">${inner}</code></pre>`;
}

function setPreviewOutput(text: string, format: PreviewFormat) {
  previewPlain = text;
  previewFormat = format;
  renderPreviewOutput();
  updatePreviewActions();
}

function renderExtractionSummary() {
  const normalizedWarnings = (currentReport?.warnings ?? [])
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0);
  const showCounts = Boolean(
    currentReport &&
      (currentSourceType === "url" || currentSourceType === "tab") &&
      ((currentReport.collapsiblesAttempted ?? 0) > 0 ||
        (currentReport.collapsiblesOpened ?? 0) > 0 ||
        (currentReport.sequentialGroupsDetected ?? 0) > 0),
  );
  const showWarnings = normalizedWarnings.length > 0;
  const hasReport = showCounts || showWarnings;

  el.report.hidden = !hasReport;
  if (!hasReport || !currentReport) {
    el.reportCounts.replaceChildren();
    el.reportWarnings.replaceChildren();
    return;
  }

  el.reportHeading.hidden = !showCounts;
  el.reportCounts.hidden = !showCounts;
  el.reportCounts.replaceChildren();
  if (showCounts) {
    if ((currentReport.collapsiblesAttempted ?? 0) > 0) {
      const item = document.createElement("li");
      item.textContent = `Collapsibles attempted: ${currentReport.collapsiblesAttempted}`;
      el.reportCounts.appendChild(item);
    }
    if ((currentReport.collapsiblesOpened ?? 0) > 0) {
      const item = document.createElement("li");
      item.textContent = `Collapsibles opened: ${currentReport.collapsiblesOpened}`;
      el.reportCounts.appendChild(item);
    }
    if ((currentReport.sequentialGroupsDetected ?? 0) > 0) {
      const item = document.createElement("li");
      item.textContent = `Sequential accordion groups: ${currentReport.sequentialGroupsDetected}`;
      el.reportCounts.appendChild(item);
    }
  }

  el.reportNotesHeading.hidden = !showWarnings;
  el.reportWarnings.hidden = !showWarnings;
  el.reportWarnings.replaceChildren();
  if (showWarnings) {
    for (const warning of normalizedWarnings) {
      const warningLine = document.createElement("p");
      warningLine.textContent = warning;
      el.reportWarnings.appendChild(warningLine);
    }
  }
}

function setCurrentReport(report: ExtractionReport | null, sourceType: ConversionSourceType | null) {
  currentReport = report;
  currentSourceType = sourceType;
  renderExtractionSummary();
}

function setError(message: string) {
  if (!message) {
    el.error.hidden = true;
    el.error.textContent = "";
    return;
  }
  el.error.hidden = false;
  el.error.textContent = message;
}

function showTab(which: "convert" | "history") {
  const isConvert = which === "convert";
  el.tabConvert.classList.toggle("active", isConvert);
  el.tabHistory.classList.toggle("active", !isConvert);
  el.tabConvert.setAttribute("aria-selected", String(isConvert));
  el.tabHistory.setAttribute("aria-selected", String(!isConvert));
  el.panelConvert.classList.toggle("hidden", !isConvert);
  el.panelHistory.classList.toggle("hidden", isConvert);
  el.panelConvert.hidden = !isConvert;
  el.panelHistory.hidden = isConvert;
}

function updatePreviewActions() {
  const has = previewPlain.trim().length > 0;
  el.copyBtn.disabled = !has;
  el.downloadBtn.disabled = !has;
}

function getHistorySearchQuery(): string {
  return el.historySearch.value.trim().toLowerCase();
}

function historyItemMatchesQuery(item: ExtensionHistoryItem, queryLower: string): boolean {
  if (!queryLower) {
    return true;
  }
  const dateLabel = formatTimestamp(item.createdAt).toLowerCase();
  const iso = item.createdAt.toLowerCase();
  const title = item.title.toLowerCase();
  const body = (item.markdown ?? item.json?.markdown ?? "").toLowerCase();
  const sourceLabel = sourceTypeLabel(item.sourceType).toLowerCase();
  const formatLabel = outputFormatLabel(item.outputFormat).toLowerCase();
  return (
    dateLabel.includes(queryLower) ||
    iso.includes(queryLower) ||
    title.includes(queryLower) ||
    body.includes(queryLower) ||
    sourceLabel.includes(queryLower) ||
    formatLabel.includes(queryLower)
  );
}

function renderHistory() {
  el.clearHistoryBtn.disabled = state.items.length === 0;

  const query = getHistorySearchQuery();
  const filtered = query
    ? state.items.filter((item) => historyItemMatchesQuery(item, query))
    : state.items;

  if (state.items.length === 0) {
    el.historyEmpty.textContent = "No conversions yet.";
    el.historyEmpty.hidden = false;
    el.historyList.innerHTML = "";
    el.historySearch.disabled = true;
    el.historySearch.value = "";
    return;
  }

  el.historySearch.disabled = false;

  if (filtered.length === 0) {
    el.historyEmpty.textContent = "No matching conversions.";
    el.historyEmpty.hidden = false;
    el.historyList.innerHTML = "";
    return;
  }

  el.historyEmpty.hidden = true;
  el.historyList.innerHTML = "";
  for (const item of filtered) {
    const tile = document.createElement("div");
    tile.className = "historyTile";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "historyTileSelect";
    selectBtn.innerHTML = `
      <div class="historyTileMeta">
        <span class="historyTileMetaDate"></span>
        <span class="historyTileMetaFlow"></span>
      </div>
      <h3 class="historyTileTitle"></h3>
      <p class="historyTilePreview"></p>
    `;
    selectBtn.querySelector(".historyTileMetaDate")!.textContent = formatTimestamp(item.createdAt);
    (selectBtn.querySelector(".historyTileMetaFlow") as HTMLElement).innerHTML = `
      <span>${sourceTypeLabel(item.sourceType)}</span>
      <span class="historyFlowArrow" aria-hidden="true">→</span>
      <span>${outputFormatLabel(item.outputFormat)}</span>
    `;
    selectBtn.querySelector(".historyTileTitle")!.textContent = item.title;
    (selectBtn.querySelector(".historyTilePreview") as HTMLElement).textContent =
      historyPreviewText(item);
    selectBtn.addEventListener("click", () => {
      selectBtn.blur();
      state.activeId = item.id;
      const output = historyOutput(item);
      setPreviewOutput(output.text, output.format);
      setCurrentReport(item.report, item.sourceType);
      void saveState(state);
      renderHistory();
      showTab("convert");
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "historyTileDelete";
    deleteBtn.setAttribute("aria-label", "Delete this history item");
    deleteBtn.innerHTML = `${TRASH_ICON_SVG}<span class="historyTileDeleteLabel">Delete</span>`;
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleDeleteHistoryItem(item.id);
    });

    tile.appendChild(selectBtn);
    tile.appendChild(deleteBtn);
    el.historyList.appendChild(tile);
  }
}

async function handleClearHistory() {
  if (state.items.length === 0) {
    return;
  }
  const confirmed = window.confirm(
    "Clear all saved conversions from this extension? This cannot be undone.",
  );
  if (!confirmed) {
    return;
  }
  state = { items: [], activeId: null, revision: state.revision };
  await saveState(state);
  el.historySearch.value = "";
  setPreviewOutput("", "markdown");
  setCurrentReport(null, null);
  renderHistory();
}

async function handleDeleteHistoryItem(id: string) {
  const exists = state.items.some((item) => item.id === id);
  if (!exists) {
    return;
  }
  const confirmed = window.confirm(
    "Remove this conversion from history? This cannot be undone.",
  );
  if (!confirmed) {
    return;
  }
  state.items = state.items.filter((item) => item.id !== id);
  if (state.activeId === id) {
    state.activeId = null;
    setPreviewOutput("", "markdown");
    setCurrentReport(null, null);
  }
  await saveState(state);
  renderHistory();
}

async function handleConvert() {
  setError("");
  el.convertBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const check = canScriptTab(tab?.url);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    if (tab.id === undefined) {
      setError("Could not read the active tab.");
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDomMainContent,
      args: [true],
    });

    const extracted = pickBestFrameResult(results);

    if (!extracted?.html?.trim()) {
      setError(
        "No content was extracted. Some doc sites load text in a cross-origin iframe—try opening the doc URL in its own tab, or a non-embedded docs page.",
      );
      return;
    }

    const markdownBody = htmlToMarkdown(extracted.html);
    const convertedAt = new Date().toISOString();
    const meta: ConversionMeta = {
      sourceType: "tab",
      source: tab.url ?? "",
      title: extracted.title,
      convertedAt,
    };
    const fullMarkdown = markdownWithYamlFrontmatter(markdownBody, meta);

    const baseForTitle = fullMarkdown;
    const heading = firstHeadingFromMarkdown(baseForTitle);
    const itemTitle = plainTitle(heading || meta.title || "Untitled conversion");

    const historyItem: ExtensionHistoryItem = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: convertedAt,
      sourceType: "tab",
      outputFormat: "markdown",
      title: itemTitle,
      preview: conversionPreview(baseForTitle),
      markdown: fullMarkdown,
      report: extracted.report,
      meta,
    };

    state.items = [historyItem, ...state.items].slice(0, SHARED_HISTORY_MAX_ITEMS);
    state.activeId = historyItem.id;
    setPreviewOutput(fullMarkdown, "markdown");
    setCurrentReport(extracted.report, "tab");
    await saveState(state);
    renderHistory();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed.";
    setError(message);
  } finally {
    el.convertBtn.disabled = false;
  }
}

function triggerCopyButtonFlash() {
  el.copyBtn.classList.remove("ghostButton--copyFlash");
  void el.copyBtn.offsetWidth;
  el.copyBtn.classList.add("ghostButton--copyFlash");
}

async function handleCopy() {
  if (!previewPlain.trim()) {
    return;
  }
  triggerCopyButtonFlash();
  try {
    await navigator.clipboard.writeText(previewPlain);
  } catch {
    el.copyBtn.classList.remove("ghostButton--copyFlash");
  }
}

function handleDownload() {
  if (!previewPlain.trim()) {
    return;
  }
  const headingCandidate =
    previewFormat === "markdown"
      ? firstHeadingFromMarkdown(previewPlain)
      : "";
  const stemFromContent = dedupeRepeatedStem(sanitizeFileStem(headingCandidate));
  const stemFromTitle = dedupeRepeatedStem(
    sanitizeFileStem(
      state.items.find((i) => i.id === state.activeId)?.title ?? headingCandidate,
    ),
  );
  const fileStem = stemFromContent || stemFromTitle || "page2md-output";
  const extension = previewFormat === "json" ? "json" : "md";
  const mimeType =
    previewFormat === "json"
      ? "application/json;charset=utf-8"
      : "text/markdown;charset=utf-8";
  const blob = new Blob([previewPlain], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${fileStem}.${extension}`;
  a.click();
  URL.revokeObjectURL(href);
}

el.tabConvert.addEventListener("click", () => showTab("convert"));
el.tabHistory.addEventListener("click", () => showTab("history"));
el.historySearch.addEventListener("input", () => renderHistory());
el.clearHistoryBtn.addEventListener("click", () => void handleClearHistory());
el.convertBtn.addEventListener("click", () => void handleConvert());
el.copyBtn.addEventListener("click", () => void handleCopy());
el.copyBtn.addEventListener("animationend", (event) => {
  if (event.animationName === "copyButtonFlash") {
    el.copyBtn.classList.remove("ghostButton--copyFlash");
  }
});
el.downloadBtn.addEventListener("click", () => handleDownload());

void (async () => {
  state = await loadState();
  setPreviewOutput("", "markdown");
  setCurrentReport(null, null);
  renderHistory();
})();
