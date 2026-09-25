/**
 * Where the person's own OpenAI API key travels (../chat/userOpenAIApiKey.ts). Kept free of imports and
 * outside chat/ because `observability/sentry/redaction.ts` drops these names, and the direct image
 * ingestion Lambda loads that redaction without any chat code.
 */
export const USER_OPENAI_API_KEY_HEADER = "x-openai-api-key";
/** The worker invoke payload field that carries the raw key. */
export const USER_OPENAI_API_KEY_WORKER_PAYLOAD_FIELD = "userOpenAIApiKey";
