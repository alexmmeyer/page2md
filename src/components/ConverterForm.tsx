"use client";

import { useMemo, useRef } from "react";

type SourceType = "url" | "html";
type OutputFormat = "markdown" | "json";

interface ConverterFormProps {
  sourceType: SourceType;
  setSourceType: (value: SourceType) => void;
  source: string;
  setSource: (value: string) => void;
  outputFormat: OutputFormat;
  setOutputFormat: (value: OutputFormat) => void;
  onConvert: () => void;
  loading: boolean;
}

export function ConverterForm({
  sourceType,
  setSourceType,
  source,
  setSource,
  outputFormat,
  setOutputFormat,
  onConvert,
  loading,
}: ConverterFormProps) {
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const sourceLabel = useMemo(
    () => (sourceType === "url" ? "Documentation URL" : "Full HTML source"),
    [sourceType],
  );

  async function handleHtmlFileSelected(file: File | null) {
    if (!file) {
      return;
    }
    const text = await file.text();
    setSource(text);
  }

  return (
    <section className="panel">
      <div className="row">
        <label className="fieldLabel" htmlFor="sourceType">
          Source
        </label>
        <div className="segmentedControl" id="sourceType">
          <button
            type="button"
            className={sourceType === "url" ? "segment active" : "segment"}
            onClick={() => setSourceType("url")}
          >
            URL
          </button>
          <button
            type="button"
            className={sourceType === "html" ? "segment active" : "segment"}
            onClick={() => setSourceType("html")}
          >
            HTML
          </button>
        </div>
      </div>

      <label className="fieldLabel" htmlFor="sourceInput">
        {sourceLabel}
      </label>
      {sourceType === "url" ? (
        <div className="inputWrap">
          <input
            id="sourceInput"
            ref={urlInputRef}
            className={`input ${source.trim().length > 0 ? "withClear" : ""}`}
            type="url"
            value={source}
            placeholder="https://example.com/docs"
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !loading && source.trim().length > 0) {
                event.preventDefault();
                onConvert();
              }
            }}
          />
          {source.trim().length > 0 ? (
            <button
              type="button"
              className="clearInputButton"
              aria-label="Clear URL"
              onClick={() => {
                setSource("");
                requestAnimationFrame(() => {
                  urlInputRef.current?.focus();
                });
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <textarea
            id="sourceInput"
            className="textarea"
            value={source}
            placeholder="Paste full page HTML here, or upload an .html file below..."
            onChange={(event) => setSource(event.target.value)}
          />
          <label className="fileLabel" htmlFor="htmlFileInput">
            Upload HTML file
          </label>
          <input
            id="htmlFileInput"
            className="fileInput"
            type="file"
            accept=".html,text/html"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void handleHtmlFileSelected(file);
            }}
          />
        </>
      )}

      <div className="row">
        <label className="fieldLabel" htmlFor="outputFormat">
          Output
        </label>
        <select
          id="outputFormat"
          className="select"
          value={outputFormat}
          onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
        >
          <option value="markdown">Markdown (default)</option>
          <option value="json">JSON (machine-readable)</option>
        </select>
      </div>

      <button
        type="button"
        className="convertButton"
        onClick={onConvert}
        disabled={loading || source.trim().length === 0}
      >
        {loading ? "Converting..." : "Convert"}
      </button>
    </section>
  );
}

