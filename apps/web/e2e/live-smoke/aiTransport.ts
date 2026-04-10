export type AiTransportRequestLike = Readonly<{
  method: string;
  url: string;
  resourceType: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type AiTransportGetRequestKind =
  | "live_attach"
  | "snapshot_poll"
  | "sessionless_chat_snapshot"
  | "other";

function hasNonEmptyQueryParam(url: URL, key: string): boolean {
  const value = url.searchParams.get(key);
  return value !== null && value.trim() !== "";
}

export function classifyAiTransportGetRequest(
  request: AiTransportRequestLike,
): AiTransportGetRequestKind {
  if (request.method !== "GET") {
    return "other";
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return "other";
  }

  const hasSessionId = hasNonEmptyQueryParam(parsedUrl, "sessionId");
  const hasRunId = hasNonEmptyQueryParam(parsedUrl, "runId");
  const acceptHeader = (request.headers.accept ?? "").toLowerCase();
  const resourceType = request.resourceType;

  if (parsedUrl.pathname === "/v1/chat") {
    if (hasSessionId === false) {
      return "sessionless_chat_snapshot";
    }

    if (hasRunId === false) {
      return "snapshot_poll";
    }
  }

  if (
    hasSessionId
    && hasRunId
    && (resourceType === "fetch" || resourceType === "eventsource")
    && acceptHeader.includes("text/event-stream")
  ) {
    return "live_attach";
  }

  return "other";
}
