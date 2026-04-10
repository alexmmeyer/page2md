"use client";

import type {
  ConversionJsonOutput,
  ConversionMeta,
  ExtractionReport,
  OutputFormat,
  SourceType,
} from "@/lib/types/conversion";

export interface HistoryItem {
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

interface HistoryPaneProps {
  items: HistoryItem[];
  activeId: string | null;
  onSelect: (item: HistoryItem) => void;
}

function sourceTypeLabel(sourceType: SourceType): string {
  if (sourceType === "url") {
    return "URL";
  }
  if (sourceType === "html") {
    return "HTML";
  }
  return "Paste";
}

function outputFormatLabel(outputFormat: OutputFormat): string {
  return outputFormat === "json" ? ".json" : ".md";
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

export function HistoryPane({ items, activeId, onSelect }: HistoryPaneProps) {
  return (
    <section className="panel historyPanel">
      <div className="outputHeader">
        <div>
          <h2>History</h2>
          <p className="muted">Session conversions</p>
        </div>
      </div>

      <div className="historyList">
        {items.length === 0 ? (
          <p className="muted">No conversions yet.</p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeId ? "historyTile active" : "historyTile"}
              onClick={() => onSelect(item)}
            >
              <div className="historyTileMeta">
                <span>{formatTimestamp(item.createdAt)}</span>
                <span>
                  {sourceTypeLabel(item.sourceType)} → {outputFormatLabel(item.outputFormat)}
                </span>
              </div>
              <h3 className="historyTileTitle">{item.title}</h3>
              <p className="historyTilePreview">{item.preview || "(No preview text available)"}</p>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

