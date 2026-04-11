import { htmlToMarkdown } from "@/lib/convert/html-to-markdown";
import { markdownWithYamlFrontmatter } from "@/lib/convert/markdown-frontmatter";
import {
  extractDomMainContent,
  type DomExtractedContent,
} from "@/lib/extract/dom-main-content";
import type { ConversionMeta, ExtractionReport } from "@/lib/types/conversion";

import { highlightMarkdownForPreview } from "./markdown-highlight";

const STORAGE_KEY = "page2md-extension-v1";
const MAX_HISTORY = 80;

interface ExtensionHistoryItem {
  id: string;
  createdAt: string;
  sourceType: "tab";
  outputFormat: "markdown";
  title: string;
  preview: string;
  markdown: string;
  report: ExtractionReport;
  meta: ConversionMeta;
}

interface PersistedState {
  items: ExtensionHistoryItem[];
  activeId: string | null;
}

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

async function loadState(): Promise<PersistedState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const payload = raw[STORAGE_KEY] as PersistedState | undefined;
  if (!payload || !Array.isArray(payload.items)) {
    return { items: [], activeId: null };
  }
  return {
    items: payload.items,
    activeId: typeof payload.activeId === "string" || payload.activeId === null ? payload.activeId : null,
  };
}

async function saveState(state: PersistedState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

const el = {
  error: document.getElementById("error") as HTMLParagraphElement,
  convertBtn: document.getElementById("convertBtn") as HTMLButtonElement,
  copyBtn: document.getElementById("copyBtn") as HTMLButtonElement,
  downloadBtn: document.getElementById("downloadBtn") as HTMLButtonElement,
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

let state: PersistedState = { items: [], activeId: null };
/** Plain markdown for copy/download and highlighting (mirrors web app Prism preview). */
let previewPlain = "";

function renderPreviewOutput() {
  if (!previewPlain.trim()) {
    el.preview.innerHTML = "";
    el.preview.classList.add("previewArea--empty");
    return;
  }
  el.preview.classList.remove("previewArea--empty");
  const inner = highlightMarkdownForPreview(previewPlain);
  el.preview.innerHTML = `<pre class="previewPre"><code class="language-markdown">${inner}</code></pre>`;
}

function setPreviewMarkdown(text: string) {
  previewPlain = text;
  renderPreviewOutput();
  updatePreviewActions();
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
  const body = item.markdown.toLowerCase();
  return (
    dateLabel.includes(queryLower) ||
    iso.includes(queryLower) ||
    title.includes(queryLower) ||
    body.includes(queryLower)
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "historyTile";
    button.innerHTML = `
      <div class="historyTileMeta"></div>
      <h3 class="historyTileTitle"></h3>
      <p class="historyTilePreview"></p>
    `;
    button.querySelector(".historyTileMeta")!.textContent = formatTimestamp(item.createdAt);
    button.querySelector(".historyTileTitle")!.textContent = item.title;
    (button.querySelector(".historyTilePreview") as HTMLElement).textContent =
      item.preview || "(No preview text available)";
    button.addEventListener("click", () => {
      state.activeId = item.id;
      setPreviewMarkdown(item.markdown);
      void saveState(state);
      renderHistory();
      showTab("convert");
    });
    el.historyList.appendChild(button);
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
  state = { items: [], activeId: null };
  await saveState(state);
  el.historySearch.value = "";
  setPreviewMarkdown("");
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

    state.items = [historyItem, ...state.items].slice(0, MAX_HISTORY);
    state.activeId = historyItem.id;
    setPreviewMarkdown(fullMarkdown);
    await saveState(state);
    renderHistory();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed.";
    setError(message);
  } finally {
    el.convertBtn.disabled = false;
  }
}

function handleCopy() {
  if (!previewPlain.trim()) {
    return;
  }
  void navigator.clipboard.writeText(previewPlain);
}

function handleDownload() {
  if (!previewPlain.trim()) {
    return;
  }
  const headingCandidate = firstHeadingFromMarkdown(previewPlain);
  const stemFromContent = dedupeRepeatedStem(sanitizeFileStem(headingCandidate));
  const stemFromTitle = dedupeRepeatedStem(
    sanitizeFileStem(
      state.items.find((i) => i.id === state.activeId)?.title ?? headingCandidate,
    ),
  );
  const fileStem = stemFromContent || stemFromTitle || "page2md-output";
  const blob = new Blob([previewPlain], { type: "text/markdown;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${fileStem}.md`;
  a.click();
  URL.revokeObjectURL(href);
}

el.tabConvert.addEventListener("click", () => showTab("convert"));
el.tabHistory.addEventListener("click", () => showTab("history"));
el.historySearch.addEventListener("input", () => renderHistory());
el.clearHistoryBtn.addEventListener("click", () => void handleClearHistory());
el.convertBtn.addEventListener("click", () => void handleConvert());
el.copyBtn.addEventListener("click", () => handleCopy());
el.downloadBtn.addEventListener("click", () => handleDownload());

void (async () => {
  state = await loadState();
  setPreviewMarkdown("");
  renderHistory();
})();
