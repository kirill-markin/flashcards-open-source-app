import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../../shared/pagination";

export type CursorQueryParams = Readonly<{
  cursor: string | null;
  limit: number;
}>;

export function parseCursorQueryParams(request: Request): CursorQueryParams {
  const url = new URL(request.url);
  return {
    cursor: parseOptionalCursorQuery(url.searchParams.get("cursor") ?? undefined, "cursor"),
    limit: parseRequiredPageLimit(url.searchParams.get("limit") ?? undefined, "limit", 100),
  };
}
