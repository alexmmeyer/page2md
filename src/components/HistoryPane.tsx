"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type {
  ConversionJsonOutput,
  ConversionSourceType,
  ConversionMeta,
  ExtractionReport,
  OutputFormat,
} from "@/lib/types/conversion";

export interface HistoryItem {
  id: string;
  createdAt: string;
  sourceType: ConversionSourceType;
  outputFormat: OutputFormat;
  title: string;
  preview: string;
  markdown?: string;
  json?: ConversionJsonOutput;
  report: ExtractionReport;
  meta: ConversionMeta;
  fromAi?: boolean;
  aiContentRegionTitle?: string;
}

function sourceTypeLabel(sourceType: ConversionSourceType): string {
  if (sourceType === "url") {
    return "URL";
  }
  if (sourceType === "html") {
    return "HTML";
  }
  if (sourceType === "tab") {
    return "Tab";
  }
  return "Paste";
}

function outputFormatLabel(outputFormat: OutputFormat): string {
  return outputFormat === "json" ? ".json" : ".md";
}

function compactJsonHistoryPreview(json: ConversionJsonOutput): string {
  const contentSnippet = json.markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 170);

  const parts = [
    json.meta?.title ? `title: ${json.meta.title}` : "",
    contentSnippet ? `content: ${contentSnippet}` : "",
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  const compact = JSON.stringify(json);
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function historyPreviewText(item: HistoryItem): string {
  if (item.outputFormat === "json") {
    if (!item.json) {
      return item.preview || "(No preview text available)";
    }
    return compactJsonHistoryPreview(item.json) || "(No preview text available)";
  }

  return item.preview || "(No preview text available)";
}

function historyPreviewBody(item: HistoryItem): ReactNode {
  const text = historyPreviewText(item);
  if (item.fromAi && item.aiContentRegionTitle) {
    return (
      <>
        <strong className="historyTilePreviewLead">{item.aiContentRegionTitle}: </strong>
        {text}
      </>
    );
  }
  return text;
}

function historyItemMatchesQuery(item: HistoryItem, queryLower: string): boolean {
  if (!queryLower) {
    return true;
  }
  const dateLabel = formatTimestamp(item.createdAt).toLowerCase();
  const iso = item.createdAt.toLowerCase();
  const title = item.title.toLowerCase();
  const body = (item.markdown ?? item.json?.markdown ?? "").toLowerCase();
  const sourceLabel = sourceTypeLabel(item.sourceType).toLowerCase();
  const formatLabel = outputFormatLabel(item.outputFormat).toLowerCase();
  const regionTitle = (item.aiContentRegionTitle ?? "").toLowerCase();
  const preview = historyPreviewText(item).toLowerCase();
  const metaTitle = (item.meta?.title ?? "").toLowerCase();
  return (
    dateLabel.includes(queryLower) ||
    iso.includes(queryLower) ||
    title.includes(queryLower) ||
    body.includes(queryLower) ||
    sourceLabel.includes(queryLower) ||
    formatLabel.includes(queryLower) ||
    regionTitle.includes(queryLower) ||
    preview.includes(queryLower) ||
    metaTitle.includes(queryLower)
  );
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

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

interface HistoryPaneProps {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearHistory: () => void;
}

export function HistoryPane({ items, onSelect, onDeleteItem, onClearHistory }: HistoryPaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const queryLower = searchQuery.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    if (!queryLower) {
      return items;
    }
    return items.filter((item) => historyItemMatchesQuery(item, queryLower));
  }, [items, queryLower]);

  useEffect(() => {
    if (items.length === 0) {
      setSearchQuery("");
    }
  }, [items.length]);

  function confirmDeleteOne() {
    return window.confirm(
      "Remove this conversion from saved history? This cannot be undone.",
    );
  }

  function confirmClearAll() {
    return window.confirm("Clear all saved conversions? This cannot be undone.");
  }

  return (
    <section className="panel historyPanel">
      <div className="outputHeader">
        <div>
          <h2>History</h2>
          <p className="muted">Saved conversions</p>
        </div>
      </div>

      <label className="historySearchLabel" htmlFor="page2md-history-search">
        Search history
      </label>
      <input
        id="page2md-history-search"
        className="historySearch"
        type="search"
        placeholder="Search by date, title, or content…"
        autoComplete="off"
        spellCheck={false}
        disabled={items.length === 0}
        aria-label="Filter history by date, title, or content"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />

      <div className="historyList">
        {items.length === 0 ? (
          <p className="muted">No conversions yet.</p>
        ) : filteredItems.length === 0 ? (
          <p className="muted">No matching conversions.</p>
        ) : (
          filteredItems.map((item) => (
            <div key={item.id} className="historyTile">
              <button
                type="button"
                className="historyTileSelect"
                onClick={(event) => {
                  onSelect(item);
                  event.currentTarget.blur();
                }}
              >
                <div className="historyTileMeta">
                  <span>{formatTimestamp(item.createdAt)}</span>
                  <span className="historyTileMetaFlow">
                    <span>{sourceTypeLabel(item.sourceType)}</span>
                    <span className="historyFlowArrow" aria-hidden="true">
                      →
                    </span>
                    <span>{outputFormatLabel(item.outputFormat)}</span>
                  </span>
                </div>
                <div className="historyTileTitleRow">
                  <h3 className="historyTileTitle">{item.title}</h3>
                  {item.fromAi ? (
                    <span className="historyTileAiBadge" title="Converted with AI">
                      AI
                    </span>
                  ) : null}
                </div>
                <p className="historyTilePreview">{historyPreviewBody(item)}</p>
              </button>
              <button
                type="button"
                className="historyTileDelete"
                aria-label="Delete this history item"
                onClick={(event) => {
                  event.stopPropagation();
                  if (confirmDeleteOne()) {
                    onDeleteItem(item.id);
                  }
                }}
              >
                <TrashIcon />
                <span className="historyTileDeleteLabel">Delete</span>
              </button>
            </div>
          ))
        )}
      </div>

      {items.length > 0 ? (
        <div className="historyPanelFooter">
          <button
            type="button"
            className="clearHistoryButton clearHistoryButtonBlock"
            onClick={() => {
              if (confirmClearAll()) {
                onClearHistory();
              }
            }}
          >
            Clear all history
          </button>
        </div>
      ) : null}
    </section>
  );
}

