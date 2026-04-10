import { resolveE2eEnvironment, validateE2eEnvironment } from "../e2eEnvironment";

export const localUiTimeoutMs = 10_000;
export const externalUiTimeoutMs = 30_000;
export const reviewPostSubmitTimeoutMs = 20_000;

export const liveSmokeEnvironment = resolveE2eEnvironment(process.env);

validateE2eEnvironment(liveSmokeEnvironment);

export const reviewEmail = process.env.FLASHCARDS_LIVE_REVIEW_EMAIL ?? "google-review@example.com";
export const authBaseUrl = liveSmokeEnvironment.authBaseUrl;
