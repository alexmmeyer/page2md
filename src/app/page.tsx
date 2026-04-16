"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { ConverterForm } from "@/components/ConverterForm";
import { HistoryPane } from "@/components/HistoryPane";
import { OutputPane } from "@/components/OutputPane";
import {
  LEGACY_WEB_SESSION_HISTORY_STORAGE_KEY,
  SHARED_HISTORY_MAX_ITEMS,
  WEB_FALLBACK_HISTORY_STORAGE_KEY,
  normalizeSharedHistoryState,
  type SharedHistoryState,
  type SharedHistoryItem,
} from "@/lib/history/shared-history";
import type {
  AiConversionResponse,
  ConversionJsonOutput,
  ExtractionRegion,
  ConversionResponse,
  ConversionSourceType,
  ExtractionReport,
  OutputFormat,
  SourceType,
} from "@/lib/types/conversion";

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

interface BridgeMessage {
  source: string;
  channel: string;
  type: string;
  requestId?: string;
  payload?: unknown;
}

interface HistoryBridgeApi {
  requestState: () => Promise<SharedHistoryState | null>;
  pushState: (state: SharedHistoryState) => void;
  subscribeToChanges: (onChanged: (state: SharedHistoryState) => void) => () => void;
}

const BRIDGE_SOURCE_WEB = "page2md-web";
const BRIDGE_SOURCE_EXTENSION = "page2md-extension";
const BRIDGE_CHANNEL = "page2md-history-bridge";
const MSG_GET_HISTORY = "PAGE2MD_GET_HISTORY";
const MSG_SET_HISTORY = "PAGE2MD_SET_HISTORY";
const MSG_HISTORY_RESPONSE = "PAGE2MD_HISTORY_RESPONSE";
const MSG_HISTORY_CHANGED = "PAGE2MD_HISTORY_CHANGED";

function createHistoryBridge(): HistoryBridgeApi {
  function isExtensionBridgeMessage(value: unknown): value is BridgeMessage {
    if (!value || typeof value !== "object") {
      return false;
    }
    const message = value as Partial<BridgeMessage>;
    return (
      message.source === BRIDGE_SOURCE_EXTENSION &&
      message.channel === BRIDGE_CHANNEL &&
      typeof message.type === "string"
    );
  }

  function normalizeState(payload: unknown): SharedHistoryState {
    return normalizeSharedHistoryState(payload);
  }

  async function requestState(): Promise<SharedHistoryState | null> {
    const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, 450);

      function onMessage(event: MessageEvent) {
        if (event.source !== window || event.origin !== window.location.origin) {
          return;
        }
        if (!isExtensionBridgeMessage(event.data)) {
          return;
        }
        if (event.data.type !== MSG_HISTORY_RESPONSE || event.data.requestId !== requestId) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(normalizeState(event.data.payload));
      }

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: BRIDGE_SOURCE_WEB,
          channel: BRIDGE_CHANNEL,
          type: MSG_GET_HISTORY,
          requestId,
        } satisfies BridgeMessage,
        window.location.origin,
      );
    });
  }

  function pushState(state: SharedHistoryState) {
    window.postMessage(
      {
        source: BRIDGE_SOURCE_WEB,
        channel: BRIDGE_CHANNEL,
        type: MSG_SET_HISTORY,
        payload: state,
      } satisfies BridgeMessage,
      window.location.origin,
    );
  }

  function subscribeToChanges(onChanged: (state: SharedHistoryState) => void): () => void {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      if (!isExtensionBridgeMessage(event.data)) {
        return;
      }
      if (event.data.type !== MSG_HISTORY_CHANGED) {
        return;
      }
      onChanged(normalizeState(event.data.payload));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }

  return { requestState, pushState, subscribeToChanges };
}

const PAGE2MD_GITHUB_REPO_URL = "https://github.com/alexmmeyer/page2md";

/** Desktop Google Chrome only (extensions are not supported in mobile browsers). */
function isGoogleChromeDesktop(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  const vendor = navigator.vendor ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return false;
  }
  const looksLikeGoogleChrome = /Chrome\//.test(ua) && vendor.includes("Google Inc");
  const isEdge = /Edg\//.test(ua);
  const isOpera = /OPR\//.test(ua);
  return looksLikeGoogleChrome && !isEdge && !isOpera;
}

function ChromeExtensionCallout({
  isChromeBrowser,
  extensionPresent,
}: {
  isChromeBrowser: boolean;
  extensionPresent: boolean | null;
}) {
  const storeUrl = process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL?.trim();

  if (!isChromeBrowser || extensionPresent !== false) {
    return null;
  }

  if (storeUrl) {
    return (
      <a
        className="ghostButton extensionInstallBtn"
        href={storeUrl}
        target="_blank"
        rel="noreferrer"
      >
        Get the chrome extension
      </a>
    );
  }

  return (
    <details className="extensionDevHint">
      <summary>Get the chrome extension</summary>
      <p className="extensionDevBody muted">
        Clone or pull from the{" "}
        <a href={PAGE2MD_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          page2md GitHub repository
        </a>
        , then run <code className="inlineCode">npm install</code> and{" "}
        <code className="inlineCode">npm run build:extension</code>. In Chrome, open{" "}
        <code className="inlineCode">chrome://extensions</code>, turn on Developer mode, click{" "}
        <strong>Load unpacked</strong>, and select the <code className="inlineCode">extension/dist</code>{" "}
        folder. Rebuild and use Reload on the extension card after updates.
      </p>
    </details>
  );
}

function resolveDisplayedOutput(
  requestedFormat: OutputFormat,
  markdownValue: string,
  jsonValue: ConversionJsonOutput | null,
): { format: OutputFormat; text: string } {
  if (requestedFormat === "json") {
    if (jsonValue) {
      return { format: "json", text: JSON.stringify(jsonValue, null, 2) };
    }
    return { format: "markdown", text: markdownValue };
  }

  if (markdownValue.trim().length > 0) {
    return { format: "markdown", text: markdownValue };
  }
  return { format: "json", text: jsonValue ? JSON.stringify(jsonValue, null, 2) : "" };
}

export default function Home() {
  const [sourceType, setSourceType] = useState<SourceType>("url");
  const [sourcesByType, setSourcesByType] = useState<Record<SourceType, string>>({
    url: "",
    html: "",
    paste: "",
  });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("markdown");
  const [loading, setLoading] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [json, setJson] = useState<ConversionJsonOutput | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [outputSourceType, setOutputSourceType] = useState<ConversionSourceType | null>(null);
  const [title, setTitle] = useState("");
  const [detectedRegions, setDetectedRegions] = useState<ExtractionRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [detectedUrlSource, setDetectedUrlSource] = useState<string | null>(null);
  const [regionSelectionEngine, setRegionSelectionEngine] = useState<
    "deterministic" | "ai" | null
  >(null);
  const [historyItems, setHistoryItems] = useState<SharedHistoryItem[]>([]);
  const historyBridgeRef = useRef<HistoryBridgeApi | null>(null);
  const syncingFromExtensionRef = useRef(false);
  const historyRevisionRef = useRef(0);
  const [isChromeBrowser, setIsChromeBrowser] = useState(false);
  const [extensionPresent, setExtensionPresent] = useState<boolean | null>(null);

  const displayedOutput = useMemo(
    () => resolveDisplayedOutput(outputFormat, markdown, json),
    [outputFormat, markdown, json],
  );
  const source = sourcesByType[sourceType];
  const showRegionChooser = sourceType === "url" && detectedRegions.length > 0;
  const convertButtonLabel = "Convert";
  const loadingButtonLabel = "Converting...";
  const convertWithAiButtonLabel = "Convert with AI";
  const loadingAiButtonLabel =
    sourceType === "url" && (!showRegionChooser || regionSelectionEngine !== "ai")
      ? "Detecting with AI..."
      : "Converting with AI...";
  const regionChooserLabel = "Select a page content region to convert";

  useEffect(() => {
    setIsChromeBrowser(isGoogleChromeDesktop());
    historyBridgeRef.current = createHistoryBridge();

    const fallbackRaw = localStorage.getItem(WEB_FALLBACK_HISTORY_STORAGE_KEY);
    const legacyRaw = sessionStorage.getItem(LEGACY_WEB_SESSION_HISTORY_STORAGE_KEY);
    const initialRaw = fallbackRaw ?? legacyRaw;

    if (initialRaw) {
      try {
        const normalized = normalizeSharedHistoryState(JSON.parse(initialRaw));
        historyRevisionRef.current = normalized.revision;
        setHistoryItems(normalized.items);
      } catch {
        // Ignore invalid local/session payload and start with empty history.
      }
    }

    void (async () => {
      const extensionState = await historyBridgeRef.current?.requestState();
      setExtensionPresent(extensionState !== null);
      if (!extensionState) {
        return;
      }
      if (extensionState.revision < historyRevisionRef.current) {
        return;
      }
      historyRevisionRef.current = extensionState.revision;
      syncingFromExtensionRef.current = true;
      setHistoryItems(extensionState.items);
    })();

    const unsubscribe = historyBridgeRef.current.subscribeToChanges((nextState) => {
      setExtensionPresent(true);
      if (nextState.revision < historyRevisionRef.current) {
        return;
      }
      historyRevisionRef.current = nextState.revision;
      syncingFromExtensionRef.current = true;
      setHistoryItems((previous) => {
        const nextSerialized = JSON.stringify(nextState.items);
        const previousSerialized = JSON.stringify(previous);
        return nextSerialized === previousSerialized ? previous : nextState.items;
      });
    });

    return () => {
      unsubscribe();
      historyBridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const nextState: SharedHistoryState = {
      items: historyItems,
      activeId: historyItems[0]?.id ?? null,
      revision: historyRevisionRef.current,
    };

    if (!syncingFromExtensionRef.current) {
      historyRevisionRef.current += 1;
      nextState.revision = historyRevisionRef.current;
    }

    try {
      localStorage.setItem(
        WEB_FALLBACK_HISTORY_STORAGE_KEY,
        JSON.stringify(nextState),
      );
      sessionStorage.removeItem(LEGACY_WEB_SESSION_HISTORY_STORAGE_KEY);
    } catch {
      // Ignore localStorage write failures.
    }

    if (syncingFromExtensionRef.current) {
      syncingFromExtensionRef.current = false;
      return;
    }

    historyBridgeRef.current?.pushState(nextState);
  }, [historyItems]);

  useEffect(() => {
    if (sourceType !== "url") {
      if (detectedRegions.length > 0 || selectedRegionId !== null || detectedUrlSource !== null) {
        setDetectedRegions([]);
        setSelectedRegionId(null);
        setDetectedUrlSource(null);
        setRegionSelectionEngine(null);
      }
      return;
    }
    if (detectedUrlSource !== null && source !== detectedUrlSource) {
      setDetectedRegions([]);
      setSelectedRegionId(null);
      setDetectedUrlSource(null);
      setRegionSelectionEngine(null);
    }
  }, [sourceType, source, detectedRegions.length, selectedRegionId, detectedUrlSource]);

  function setSource(value: string) {
    setSourcesByType((previous) => ({
      ...previous,
      [sourceType]: value,
    }));
  }

  async function handleConvert() {
    if (loading || loadingAi) {
      return;
    }
    if (source.trim().length === 0) {
      setError("Please provide input before converting.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceType,
          source,
          outputFormat,
          mainContentOnly: true,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Conversion failed.");
      }

      const conversion = payload as ConversionResponse;
      const resolvedMarkdown = conversion.markdown ?? "";
      const resolvedJson = conversion.json ?? null;
      setMarkdown(resolvedMarkdown);
      setJson(resolvedJson);
      setReport(payload.report);
      setOutputSourceType(conversion.meta.sourceType);
      setTitle(
        payload.selectedRegionLabel
          ? `${payload.meta?.title ?? ""} — ${payload.selectedRegionLabel}`
          : (payload.meta?.title ?? ""),
      );

      const baseMarkdown = conversion.markdown ?? conversion.json?.markdown ?? "";
      const heading = firstHeadingFromMarkdown(baseMarkdown);
      const itemTitle = plainTitle(heading || conversion.meta?.title || "Untitled conversion");
      const historyItem: SharedHistoryItem = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
        sourceType,
        outputFormat,
        title: itemTitle,
        preview: conversionPreview(baseMarkdown),
        markdown: conversion.markdown,
        json: conversion.json,
        report: conversion.report,
        meta: conversion.meta,
      };
      setHistoryItems((previous) =>
        [historyItem, ...previous].slice(0, SHARED_HISTORY_MAX_ITEMS),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConvertWithAi() {
    if (loading || loadingAi) {
      return;
    }
    if (source.trim().length === 0) {
      setError("Please provide input before converting.");
      return;
    }

    setLoadingAi(true);
    setError("");
    try {
      if (
        sourceType === "url" &&
        (detectedRegions.length === 0 ||
          detectedUrlSource !== source ||
          regionSelectionEngine !== "ai")
      ) {
        const detectResponse = await fetch("/api/convert-ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            engine: "ai",
            stage: "detect",
            sourceType,
            source,
            outputFormat,
          }),
        });
        const detectPayload = await detectResponse.json();
        if (!detectResponse.ok) {
          throw new Error(detectPayload.error ?? "Could not detect regions with AI.");
        }
        const detection = detectPayload as AiConversionResponse;
        const sourceRegions = detection.regions ?? [];
        const aiRegions = detection.aiRegions ?? [];
        const nextRegions: ExtractionRegion[] = [];
        for (const aiRegion of aiRegions) {
          const sourceRegion = sourceRegions.find(
            (candidate) => candidate.id === aiRegion.sourceRegionId,
          );
          if (!sourceRegion) continue;
          const region: ExtractionRegion = {
            ...sourceRegion,
            id: sourceRegion.id,
            label: aiRegion.label,
            score: aiRegion.score,
          };
          if (aiRegion.description) {
            region.description = aiRegion.description;
          }
          nextRegions.push(region);
        }

        if (nextRegions.length === 0) {
          throw new Error("No AI regions were detected for this page.");
        }
        const defaultRegionId = detection.defaultRegionId ?? nextRegions[0]?.id ?? null;
        setDetectedRegions(nextRegions);
        setSelectedRegionId(defaultRegionId);
        setDetectedUrlSource(source);
        setRegionSelectionEngine("ai");
        setOutputSourceType(detection.meta.sourceType);
        setReport(detection.report);
        setTitle(detection.meta.title || "Select a region to convert");
        return;
      }

      await runAiConvert();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoadingAi(false);
    }
  }

  async function runAiConvert(overrideRegionId?: string) {
    const regionIdToConvert = overrideRegionId ?? selectedRegionId;
    if (sourceType === "url" && !regionIdToConvert) {
      throw new Error("Select a content region first.");
    }

    const response = await fetch("/api/convert-ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        engine: "ai",
        stage: "convert",
        sourceType,
        source,
        outputFormat,
        selectedRegionId: sourceType === "url" ? regionIdToConvert : undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "AI conversion failed.");
    }

    const conversion = payload as AiConversionResponse;
    const resolvedMarkdown = conversion.markdown ?? "";
    const resolvedJson = conversion.json ?? null;
    setMarkdown(resolvedMarkdown);
    setJson(resolvedJson);
    const mergedWarnings = [...(conversion.report.warnings ?? []), ...(conversion.aiWarnings ?? [])];
    setReport({ ...conversion.report, warnings: mergedWarnings });
    setOutputSourceType(conversion.meta.sourceType);
    setTitle(
      conversion.selectedRegionLabel
        ? `${conversion.meta?.title ?? ""} — ${conversion.selectedRegionLabel} (AI)`
        : `${conversion.meta?.title ?? ""} (AI)`,
    );

    const baseMarkdown = conversion.markdown ?? conversion.json?.markdown ?? "";
    const heading = firstHeadingFromMarkdown(baseMarkdown);
    const itemTitle = plainTitle(heading || conversion.meta?.title || "Untitled AI conversion");
    const historyItem: SharedHistoryItem = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      sourceType,
      outputFormat,
      title: itemTitle,
      preview: conversionPreview(baseMarkdown),
      markdown: conversion.markdown,
      json: conversion.json,
      report: { ...conversion.report, warnings: mergedWarnings },
      meta: conversion.meta,
    };
    setHistoryItems((previous) =>
      [historyItem, ...previous].slice(0, SHARED_HISTORY_MAX_ITEMS),
    );
  }

  async function handleRegionConvert(regionId: string) {
    if (loading || loadingAi) return;
    setSelectedRegionId(regionId);
    setLoadingAi(true);
    setError("");
    try {
      await runAiConvert(regionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoadingAi(false);
    }
  }

  function handleSelectHistory(item: SharedHistoryItem) {
    setMarkdown(item.markdown ?? "");
    setJson(item.json ?? null);
    setReport(item.report);
    setOutputSourceType(item.meta.sourceType);
    setOutputFormat(item.outputFormat);
    setTitle(item.meta.title);
  }

  function handleDeleteHistoryItem(id: string) {
    setHistoryItems((previous) => previous.filter((item) => item.id !== id));
  }

  function handleClearHistory() {
    setHistoryItems([]);
  }

  function handleCopy(): Promise<void> {
    if (displayedOutput.text.trim().length === 0) {
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(displayedOutput.text);
  }

  async function handleDownload() {
    if (displayedOutput.text.trim().length === 0) {
      return;
    }

    const text = displayedOutput.text;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const headingCandidate = firstHeadingFromMarkdown(markdown);
    const stemFromContent = dedupeRepeatedStem(sanitizeFileStem(headingCandidate));
    const stemFromTitle = dedupeRepeatedStem(sanitizeFileStem(title));
    const fileStem = stemFromContent || stemFromTitle || "page2md-output";
    const extension = displayedOutput.format === "json" ? ".json" : ".md";
    const suggestedName = `${fileStem}${extension}`;

    type SaveFilePickerWindow = Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{
          description: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    const pickerWindow = window as SaveFilePickerWindow;
    if (pickerWindow.showSaveFilePicker) {
      try {
        const fileHandle = await pickerWindow.showSaveFilePicker({
          suggestedName,
          types: [
            outputFormat === "json"
              ? {
                  description: "JSON file",
                  accept: { "application/json": [".json"] },
                }
              : {
                  description: "Markdown file",
                  accept: { "text/markdown": [".md"] },
                },
          ],
        });

        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        // If user cancels, do nothing. Only fall back for unsupported/rejected APIs.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(href);
  }

  return (
    <main className="appShell">
      <header className="header headerWithActions">
        <div>
          <h1>page2md</h1>
          <p>Convert rich docs pages into markdown in one shot.</p>
        </div>
        <ChromeExtensionCallout
          isChromeBrowser={isChromeBrowser}
          extensionPresent={extensionPresent}
        />
      </header>

      <div className="grid">
        <ConverterForm
          sourceType={sourceType}
          setSourceType={setSourceType}
          source={source}
          setSource={setSource}
          outputFormat={outputFormat}
          setOutputFormat={setOutputFormat}
          onConvert={handleConvert}
          onConvertWithAi={handleConvertWithAi}
          regionOptions={detectedRegions}
          selectedRegionId={selectedRegionId}
          onSelectRegion={setSelectedRegionId}
          onRegionConvert={handleRegionConvert}
          showRegionChooser={showRegionChooser}
          regionChooserLabel={regionChooserLabel}
          convertButtonLabel={convertButtonLabel}
          loadingButtonLabel={loadingButtonLabel}
          convertWithAiButtonLabel={convertWithAiButtonLabel}
          loadingAiButtonLabel={loadingAiButtonLabel}
          loading={loading}
          loadingAi={loadingAi}
          disableActions={loading || loadingAi}
        />
        <OutputPane
          markdown={markdown}
          json={json}
          outputFormat={outputFormat}
          report={report}
          outputSourceType={outputSourceType}
          title={title}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />
        <HistoryPane
          items={historyItems}
          onSelect={handleSelectHistory}
          onDeleteItem={handleDeleteHistoryItem}
          onClearHistory={handleClearHistory}
        />
      </div>

      {error ? <p className="errorText">{error}</p> : null}
      <footer className="appFooter">
        <Link href="/privacy" className="appFooterLink">
          Privacy Policy
        </Link>
      </footer>
    </main>
  );
}
