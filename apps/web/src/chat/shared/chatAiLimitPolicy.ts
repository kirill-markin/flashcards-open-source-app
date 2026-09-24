// `AI_LIMIT_REACHED` is accepted ahead of the backend change that starts raising it for every caller.
// `GUEST_AI_LIMIT_REACHED` is the guest-only code that change supersedes; it cannot reach the web app,
// whose guest credential is refused on every authenticated surface, and it stays matched only so a
// deployed backend still raising it is handled the same way.
export const AI_LIMIT_REACHED_CODE = "AI_LIMIT_REACHED";
export const GUEST_AI_LIMIT_REACHED_CODE = "GUEST_AI_LIMIT_REACHED";

export function isAiLimitReachedError(params: Readonly<{
  code: string | null;
}>): boolean {
  return params.code === AI_LIMIT_REACHED_CODE || params.code === GUEST_AI_LIMIT_REACHED_CODE;
}
