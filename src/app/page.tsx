"use client";

import { useMemo, useState } from "react";

import { ConverterForm } from "@/components/ConverterForm";
import { OutputPane } from "@/components/OutputPane";
import type { ConversionJsonOutput, ExtractionReport } from "@/lib/types/conversion";

type SourceType = "url" | "html";
type OutputFormat = "markdown" | "json";

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

  function handleDownload() {
    if (!hasOutput) {
      return;
    }

    const text = outputFormat === "json" ? JSON.stringify(json, null, 2) : markdown;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = outputFormat === "json" ? "page2md-output.json" : "page2md-output.md";
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
