"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import type {
  ConversionJsonOutput,
  ConversionSourceType,
  ExtractionReport,
} from "@/lib/types/conversion";

type OutputFormat = "markdown" | "json";

interface OutputPaneProps {
  markdown: string;
  json: ConversionJsonOutput | null;
  outputFormat: OutputFormat;
  report: ExtractionReport | null;
  outputSourceType: ConversionSourceType | null;
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

function resolvePreview(
  requestedFormat: OutputFormat,
  markdownValue: string,
  jsonValue: ConversionJsonOutput | null,
): { language: "markdown" | "json"; value: string } {
  if (requestedFormat === "json") {
    if (jsonValue) {
      return { language: "json", value: prettyJson(jsonValue) };
    }
    return { language: "markdown", value: markdownValue };
  }

  if (markdownValue.trim().length > 0) {
    return { language: "markdown", value: markdownValue };
  }
  return { language: "json", value: prettyJson(jsonValue) };
}

export function OutputPane({
  markdown,
  json,
  outputFormat,
  report,
  outputSourceType,
  title,
  onCopy,
  onDownload,
}: OutputPaneProps) {
  const preview = resolvePreview(outputFormat, markdown, json);
  const previewValue = preview.value;
  const language = preview.language;
  const hasPreview = previewValue.trim().length > 0;
  const showCounts = Boolean(
    report &&
      (outputSourceType === "url" || outputSourceType === "tab") &&
      ((report.collapsiblesAttempted ?? 0) > 0 ||
        (report.collapsiblesOpened ?? 0) > 0 ||
        (report.sequentialGroupsDetected ?? 0) > 0),
  );
  const showWarnings = Boolean(report?.warnings.length);
  const hasReport = showCounts || showWarnings;

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

      <div className={hasReport ? "previewWrap" : "previewWrap previewWrapFill"}>
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: 12,
            fontSize: "13px",
            lineHeight: "1.6",
            fontFamily:
              "var(--font-space-grotesk), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
            minHeight: hasReport ? 400 : "100%",
            maxHeight: hasReport ? 560 : "100%",
            height: hasReport ? undefined : "100%",
          }}
          wrapLongLines={false}
          showLineNumbers={false}
        >
          {hasPreview ? previewValue : "# Output preview appears here"}
        </SyntaxHighlighter>
      </div>

      {hasReport ? (
        <div className="report">
          {showCounts ? (
            <>
              <h3>Extraction summary</h3>
              <ul>
                {(report?.collapsiblesAttempted ?? 0) > 0 ? (
                  <li>Collapsibles attempted: {report?.collapsiblesAttempted ?? 0}</li>
                ) : null}
                {(report?.collapsiblesOpened ?? 0) > 0 ? (
                  <li>Collapsibles opened: {report?.collapsiblesOpened ?? 0}</li>
                ) : null}
                {(report?.sequentialGroupsDetected ?? 0) > 0 ? (
                  <li>Sequential accordion groups: {report?.sequentialGroupsDetected ?? 0}</li>
                ) : null}
              </ul>
            </>
          ) : null}
          {showWarnings ? (
            <>
              <h3>{showCounts ? "Notes" : "Notes"}</h3>
              <div className="warningBox">
                {report?.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

