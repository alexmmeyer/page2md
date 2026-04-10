export type SourceType = "url" | "html";
export type OutputFormat = "markdown" | "json";

export interface ConversionRequest {
  sourceType: SourceType;
  source: string;
  outputFormat: OutputFormat;
  mainContentOnly: boolean;
}

export interface ExtractionReport {
  collapsiblesAttempted: number;
  collapsiblesOpened: number;
  sequentialGroupsDetected: number;
  warnings: string[];
}

export interface ConversionMeta {
  sourceType: SourceType;
  source: string;
  title: string;
  convertedAt: string;
}

export interface ConversionJsonOutput {
  meta: ConversionMeta;
  report: ExtractionReport;
  markdown: string;
  sections: Array<{
    level: number;
    title: string;
  }>;
}

export interface ConversionResponse {
  markdown: string;
  json: ConversionJsonOutput;
  report: ExtractionReport;
  meta: ConversionMeta;
}
