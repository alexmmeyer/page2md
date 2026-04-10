"use client";

import { useMemo, useState } from "react";

import { ConverterForm } from "@/components/ConverterForm";
import { OutputPane } from "@/components/OutputPane";
import type { ConversionJsonOutput, ExtractionReport } from "@/lib/types/conversion";

type SourceType = "url" | "html";
type OutputFormat = "markdown" | "json";

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

export default function Home() {
  const [sourceType, setSourceType] = useState<SourceType>("url");
  const [source, setSource] = useState("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("markdown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [json, setJson] = useState<ConversionJsonOutput | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [title, setTitle] = useState("");

  const hasOutput = useMemo(
    () => (outputFormat === "json" ? Boolean(json) : markdown.trim().length > 0),
    [json, markdown, outputFormat],
  );

  async function handleConvert() {
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

      setMarkdown(payload.markdown);
      setJson(payload.json);
      setReport(payload.report);
      setTitle(payload.meta?.title ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!hasOutput) {
      return;
    }
    const text = outputFormat === "json" ? JSON.stringify(json, null, 2) : markdown;
    navigator.clipboard.writeText(text);
  }

  async function handleDownload() {
    if (!hasOutput) {
      return;
    }

    const text = outputFormat === "json" ? JSON.stringify(json, null, 2) : markdown;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const headingCandidate = firstHeadingFromMarkdown(markdown);
    const stemFromContent = sanitizeFileStem(headingCandidate);
    const stemFromTitle = sanitizeFileStem(title);
    const fileStem = stemFromContent || stemFromTitle || "page2md-output";
    const extension = outputFormat === "json" ? ".json" : ".md";
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
        <h1>Page2MD</h1>
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
          title={title}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />
      </div>

      {error ? <p className="errorText">{error}</p> : null}
    </main>
  );
}
