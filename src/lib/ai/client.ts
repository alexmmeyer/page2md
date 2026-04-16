import OpenAI from "openai";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_DETECT_MODEL = "gpt-4.1";

let cachedClient: OpenAI | null = null;

export function getAiModelName(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function getAiDetectModelName(): string {
  return (
    process.env.OPENAI_DETECT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_OPENAI_DETECT_MODEL
  );
}

export function getAiConvertModelName(): string {
  return process.env.OPENAI_CONVERT_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
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

export const AI_DETECT_TIMEOUT_MS = 18_000;
export const AI_CONVERT_TIMEOUT_MS = 22_000;
