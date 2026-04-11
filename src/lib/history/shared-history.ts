import type {
  ConversionJsonOutput,
  ConversionMeta,
  ConversionSourceType,
  ExtractionReport,
  OutputFormat,
} from "@/lib/types/conversion";

export const SHARED_HISTORY_STORAGE_KEY = "page2md-extension-v1";
export const WEB_FALLBACK_HISTORY_STORAGE_KEY = "page2md-web-history-v1";
export const LEGACY_WEB_SESSION_HISTORY_STORAGE_KEY = "page2md-session-history";
export const SHARED_HISTORY_MAX_ITEMS = 80;

export interface SharedHistoryItem {
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
}

export interface SharedHistoryState {
  items: SharedHistoryItem[];
  activeId: string | null;
  revision: number;
}

export function normalizeSharedHistoryState(value: unknown): SharedHistoryState {
  if (!value || typeof value !== "object") {
    return { items: [], activeId: null, revision: 0 };
  }

  const candidate = value as Partial<SharedHistoryState>;
  const revision =
    typeof candidate.revision === "number" && Number.isFinite(candidate.revision)
      ? Math.max(0, Math.floor(candidate.revision))
      : 0;
  return {
    items: Array.isArray(candidate.items) ? candidate.items : [],
    activeId:
      typeof candidate.activeId === "string" || candidate.activeId === null
        ? candidate.activeId
        : null,
    revision,
  };
}
