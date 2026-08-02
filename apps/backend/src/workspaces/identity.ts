const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function normalizeWorkspaceId(value: string): string {
  return value.trim();
}

export function isWorkspaceId(value: string): boolean {
  return workspaceIdPattern.test(value);
}

export function isLowercaseWorkspaceId(value: string): boolean {
  return isWorkspaceId(value) && value === value.toLowerCase();
}
