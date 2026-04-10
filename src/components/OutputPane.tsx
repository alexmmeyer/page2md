"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import type { ConversionJsonOutput, ExtractionReport } from "@/lib/types/conversion";

type OutputFormat = "markdown" | "json";

interface OutputPaneProps {
  markdown: string;
  json: ConversionJsonOutput | null;
  outputFormat: OutputFormat;
  report: ExtractionReport | null;
  title: string;
  onCopy: () => void;
  onDownload: () => void;
}

function prettyJson(json: ConversionJsonOutput | null): string {
  if (!json) {
    return "";
  }
  return JSON.stringify(json, null, 2);
}

export function OutputPane({
  markdown,
  json,
  outputFormat,
  report,
  title,
  onCopy,
  onDownload,
}: OutputPaneProps) {
  const previewValue = outputFormat === "json" ? prettyJson(json) : markdown;
  const language = outputFormat === "json" ? "json" : "markdown";
  const hasPreview = previewValue.trim().length > 0;

  return (
    <section className="panel outputPanel">
      <div className="outputHeader">
        <div>
          <h2>Preview</h2>
          <p className="muted">{title || "Run conversion to see output."}</p>
        </div>
        <div className="actionRow">
          <button className="ghostButton" type="button" onClick={onCopy} disabled={!hasPreview}>
            Copy
          </button>
          <button
            className="ghostButton"
            type="button"
            onClick={onDownload}
            disabled={!hasPreview}
          >
            Download
          </button>
        </div>
      </div>

      <div className="previewWrap">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: 12,
            fontSize: "13px",
            lineHeight: "1.6",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
            minHeight: 400,
            maxHeight: 560,
          }}
          wrapLongLines={false}
          showLineNumbers={false}
        >
          {hasPreview ? previewValue : "# Output preview appears here"}
        </SyntaxHighlighter>
      </div>

      {report?.warnings.length ? (
        <div className="report">
          <h3>Notes</h3>
          <div className="warningBox">
            {report.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

