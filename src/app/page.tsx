"use client";

import { useEffect, useMemo, useState } from "react";

import { ConverterForm } from "@/components/ConverterForm";
import { HistoryPane } from "@/components/HistoryPane";
import { OutputPane } from "@/components/OutputPane";
import type {
  ConversionJsonOutput,
  ConversionMeta,
  OutputFormat,
  ConversionResponse,
  ExtractionReport,
  SourceType,
} from "@/lib/types/conversion";

interface HistoryItem {
  id: string;
  createdAt: string;
  sourceType: SourceType;
  outputFormat: OutputFormat;
  title: string;
  preview: string;
  markdown?: string;
  json?: ConversionJsonOutput;
  report: ExtractionReport;
  meta: ConversionMeta;
}

const HISTORY_STORAGE_KEY = "page2md-session-history";

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
  const [error, setError] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [json, setJson] = useState<ConversionJsonOutput | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [outputSourceType, setOutputSourceType] = useState<SourceType | null>(null);
  const [title, setTitle] = useState("");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const displayedOutput = useMemo(
    () => resolveDisplayedOutput(outputFormat, markdown, json),
    [outputFormat, markdown, json],
  );
  const source = sourcesByType[sourceType];

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        items?: HistoryItem[];
        activeId?: string | null;
      };

      const restoredItems = Array.isArray(parsed.items) ? parsed.items : [];
      const restoredActiveId =
        typeof parsed.activeId === "string" || parsed.activeId === null
          ? parsed.activeId
          : null;

      setHistoryItems(restoredItems);
      setActiveHistoryId(restoredActiveId ?? null);
    } catch {
      // Ignore invalid session payload and start with empty history.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        HISTORY_STORAGE_KEY,
        JSON.stringify({
          items: historyItems,
          activeId: activeHistoryId,
        }),
      );
    } catch {
      // Ignore sessionStorage write failures.
    }
  }, [activeHistoryId, historyItems]);

  function setSource(value: string) {
    setSourcesByType((previous) => ({
      ...previous,
      [sourceType]: value,
    }));
  }

  async function handleConvert() {
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
      setTitle(payload.meta?.title ?? "");

      const baseMarkdown = conversion.markdown ?? conversion.json?.markdown ?? "";
      const heading = firstHeadingFromMarkdown(baseMarkdown);
      const itemTitle = plainTitle(heading || conversion.meta?.title || "Untitled conversion");
      const historyItem: HistoryItem = {
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
      setHistoryItems((previous) => [historyItem, ...previous]);
      setActiveHistoryId(historyItem.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectHistory(item: HistoryItem) {
    setMarkdown(item.markdown ?? "");
    setJson(item.json ?? null);
    setReport(item.report);
    setOutputSourceType(item.meta.sourceType);
    setOutputFormat(item.outputFormat);
    setTitle(item.meta.title);
    setActiveHistoryId(item.id);
  }

  function handleCopy() {
    if (displayedOutput.text.trim().length === 0) {
      return;
    }
    navigator.clipboard.writeText(displayedOutput.text);
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
      <header className="header">
        <h1>page2md</h1>
        <p>Convert rich docs pages into markdown in one shot.</p>
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
          loading={loading}
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
          activeId={activeHistoryId}
          onSelect={handleSelectHistory}
        />
      </div>

      {error ? <p className="errorText">{error}</p> : null}
    </main>
  );
}
