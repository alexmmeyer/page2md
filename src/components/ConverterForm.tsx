"use client";

import { useEffect, useMemo, useRef } from "react";

type SourceType = "url" | "html" | "paste";
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
  const htmlInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pasteEditorRef = useRef<HTMLDivElement | null>(null);
  const sourceLabel = useMemo(
    () => {
      if (sourceType === "url") {
        return "Documentation URL";
      }
      if (sourceType === "html") {
        return "Full HTML source";
      }
      return "Snippet to convert";
    },
    [sourceType],
  );

  async function handleHtmlFileSelected(file: File | null) {
    if (!file) {
      return;
    }
    const text = await file.text();
    setSource(text);
  }

  const hasSource = source.trim().length > 0;
  const isSubmitKey = (key: string) => key === "Enter" || key === "NumpadEnter";

  useEffect(() => {
    if (sourceType !== "paste" || !pasteEditorRef.current) {
      return;
    }

    if (pasteEditorRef.current.innerHTML !== source) {
      pasteEditorRef.current.innerHTML = source;
    }
  }, [source, sourceType]);

  return (
    <section className="panel">
      <div className="outputHeader">
        <div>
          <h2>Input</h2>
          <p className="muted">Choose source mode and provide content.</p>
        </div>
      </div>
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
            className={sourceType === "paste" ? "segment active" : "segment"}
            onClick={() => setSourceType("paste")}
          >
            Paste
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
            className={`input ${hasSource ? "withClear" : ""}`}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            name="page2md-url-input"
            value={source}
            placeholder="https://example.com/docs"
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (isSubmitKey(event.key) && !loading && hasSource) {
                event.preventDefault();
                onConvert();
              }
            }}
          />
          {hasSource ? (
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
      ) : sourceType === "html" ? (
        <div className="inputWrap">
          <textarea
            id="sourceInput"
            ref={htmlInputRef}
            className={`textarea ${hasSource ? "withClear" : ""}`}
            value={source}
            placeholder="Paste full page HTML here, or upload an .html file below..."
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (isSubmitKey(event.key) && !loading && hasSource) {
                event.preventDefault();
                onConvert();
              }
            }}
          />
          {hasSource ? (
            <button
              type="button"
              className="clearInputButton clearInputButtonTop"
              aria-label="Clear HTML source"
              onClick={() => {
                setSource("");
                requestAnimationFrame(() => {
                  htmlInputRef.current?.focus();
                });
              }}
            >
              ×
            </button>
          ) : null}
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
        </div>
      ) : (
        <div className="inputWrap">
          <div
            id="sourceInput"
            ref={pasteEditorRef}
            className={`textarea pasteEditor ${hasSource ? "withClear" : ""}`}
            role="textbox"
            aria-multiline="true"
            contentEditable
            data-placeholder="Paste a snippet with formatting (lists, tables, links, etc.)..."
            onInput={(event) => {
              setSource(event.currentTarget.innerHTML);
            }}
            onPaste={() => {
              requestAnimationFrame(() => {
                setSource(pasteEditorRef.current?.innerHTML ?? "");
              });
            }}
            onKeyDown={(event) => {
              if (isSubmitKey(event.key) && !event.shiftKey && !loading && hasSource) {
                event.preventDefault();
                onConvert();
              }
            }}
          />
          {hasSource ? (
            <button
              type="button"
              className="clearInputButton"
              aria-label="Clear pasted content"
              onClick={() => {
                setSource("");
                if (pasteEditorRef.current) {
                  pasteEditorRef.current.innerHTML = "";
                }
                requestAnimationFrame(() => {
                  pasteEditorRef.current?.focus();
                });
              }}
            >
              ×
            </button>
          ) : null}
        </div>
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
          <option value="markdown">Markdown</option>
          <option value="json">JSON (machine-readable)</option>
        </select>
      </div>

      <button
        type="button"
        className="convertButton"
        onClick={() => {
          if (!hasSource) {
            return;
          }
          onConvert();
        }}
        onKeyDown={(event) => {
          if (isSubmitKey(event.key) && !loading && hasSource) {
            event.preventDefault();
            onConvert();
          }
        }}
        disabled={loading}
      >
        {loading ? "Converting..." : "Convert"}
      </button>
    </section>
  );
}

