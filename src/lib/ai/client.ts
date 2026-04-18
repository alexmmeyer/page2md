import OpenAI from "openai";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
/**
 * Detect uses a vision-capable model. Default to gpt-4.1 since it supports
 * image inputs; do NOT fall back to OPENAI_MODEL because that is typically
 * set to a smaller/cheaper model that may struggle with vision reasoning.
 */
const DEFAULT_OPENAI_DETECT_MODEL = "gpt-4.1";

let cachedClient: OpenAI | null = null;

export function getAiModelName(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function getAiDetectModelName(): string {
  return process.env.OPENAI_DETECT_MODEL?.trim() || DEFAULT_OPENAI_DETECT_MODEL;
}

export function getAiConvertModelName(): string {
  return process.env.OPENAI_CONVERT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function getAiCleanModelName(): string {
  return process.env.OPENAI_CLEAN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it in your environment before using Convert with AI.",
    );
  }
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

// Vision detect needs more headroom than text-only — image tokens + reasoning.
export const AI_DETECT_TIMEOUT_MS = 60_000;
export const AI_CONVERT_TIMEOUT_MS = 30_000;
export const AI_CLEAN_TIMEOUT_MS = 30_000;
