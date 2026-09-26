export const OAUTH_SCOPES = ["flashcards", "openid", "email"] as const;

export function hasOAuthScope(scope: string | null, name: string): boolean {
  return scope !== null && scope.split(/\s+/).includes(name);
}

export function isSupportedOAuthScope(scope: string | null): boolean {
  if (scope === null) {
    return true;
  }
  const scopes = scope.split(/\s+/);
  return scopes.every((entry) => OAUTH_SCOPES.some((supported) => supported === entry))
    && (!scopes.includes("email") || scopes.includes("openid"));
}
