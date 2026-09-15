/**
 * The remediation text every agent surface returns with a failing call, keyed by error code in one
 * place: the agent-facing REST routes, MCP, and the in-app chat all render from here. The
 * `/v1/agent-api-keys` connection-management routes split by CALLER rather than by route: the
 * global handler in `apps/backend/src/server/app.ts` tests the `ApiKey` Authorization header
 * BEFORE the connection-management path, so only a human browser or mobile session gets that
 * file's own wording, while those same routes called under an `ApiKey` header - which they always
 * reject, see `requireHumanManagedConnectionAccess` - are answered by
 * `createAgentApiKeyErrorEnvelope` and therefore render from here as `{ surface: "rest" }`.
 * Do not reorder those two branches to tidy this up: it would swap the envelope shape those routes
 * return to already-released `ApiKey` clients.
 *
 * The code decides the MEANING of a failure and the surface decides its WORDING. An MCP client and
 * the chat model call tools: neither can honour a `Retry-After` header, call an HTTP route, or
 * resume a multipart upload session, and each reads the failure out of its own envelope shape,
 * while the REST surface speaks of requests rather than tools. So a meaning is stated once and
 * worded per surface, and a meaning a surface leaves unworded falls through to that surface's
 * generic wording - which is also what a code this module does not know gets everywhere.
 */

/** How a surface identifies the call that failed: REST by its request URL, tool surfaces by tool. */
export type AgentRemediationCall =
  | Readonly<{ surface: "rest"; requestUrl: string }>
  | Readonly<{ surface: "mcp"; toolName: string }>
  | Readonly<{ surface: "chat"; toolName: string }>;

/**
 * The review-submission tool, named here instead of imported from
 * `apps/backend/src/aiTools/toolRegistry/specs.ts`: the REST agent envelope reaches this module
 * from the slim direct-image-ingestion entrypoint, which must not load the whole tool registry.
 */
const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

/**
 * What the failing call was doing, in terms no surface owns: remediation differs between
 * submitting a review and completing or aborting a multipart upload, and each surface recognizes
 * the same operation its own way.
 */
type FailingOperation =
  | "review_submission"
  | "multipart_completion"
  | "multipart_abort"
  | "other";

/** An agent request URL can arrive relative, so every pathname read shares this fallback base. */
function getAgentRequestPathname(requestUrl: string): string {
  return new URL(requestUrl, "https://api.flashcards-open-source-app.com").pathname;
}

function resolveRestOperation(requestUrl: string): FailingOperation {
  const pathname = getAgentRequestPathname(requestUrl);
  if (pathname.endsWith("/agent/reviews/submit")) {
    return "review_submission";
  }

  if (/\/media-assets\/upload-sessions\/[^/]+\/complete\/?$/.test(pathname)) {
    return "multipart_completion";
  }

  if (/\/media-assets\/upload-sessions\/[^/]+\/abort\/?$/.test(pathname)) {
    return "multipart_abort";
  }

  return "other";
}

function resolveFailingOperation(call: AgentRemediationCall): FailingOperation {
  if (call.surface === "rest") {
    return resolveRestOperation(call.requestUrl);
  }

  return call.toolName === SUBMIT_REVIEW_TOOL_NAME ? "review_submission" : "other";
}

type RestRemediationContext = Readonly<{
  statusCode: number;
  operation: FailingOperation;
}>;

/** MCP and the chat know the same thing about a failing call: which tool the model called. */
type ToolRemediationContext = Readonly<{
  toolName: string;
  statusCode: number;
  operation: FailingOperation;
}>;

type RestWording = (context: RestRemediationContext) => string;
type ToolWording = (context: ToolRemediationContext) => string;

/**
 * The failure meanings more than one surface can raise. A code only one surface can reach carries
 * no meaning here and is worded by that surface alone; see `REST_CODE_INSTRUCTIONS`.
 */
type RemediationMeaning =
  | "sql_rejected"
  | "workspace_selection_required"
  | "review_schedule_stale"
  | "review_already_recorded"
  | "commit_outcome_unknown"
  | "service_temporarily_unavailable";

const MEANING_BY_CODE: Readonly<Record<string, RemediationMeaning | undefined>> = {
  QUERY_INVALID_SQL: "sql_rejected",
  QUERY_UNSUPPORTED_SYNTAX: "sql_rejected",
  WORKSPACE_SELECTION_REQUIRED: "workspace_selection_required",
  REVIEW_STALE: "review_schedule_stale",
  REVIEW_EVENT_CONFLICT: "review_already_recorded",
  DATABASE_COMMIT_OUTCOME_UNKNOWN: "commit_outcome_unknown",
  SERVICE_UNAVAILABLE: "service_temporarily_unavailable",
};

/**
 * `shared` is the wording of a meaning no surface rewords, because it describes the state the
 * caller is already in rather than an action a transport offers.
 */
type MeaningWording = Readonly<{
  shared?: string;
  rest?: RestWording;
  mcp?: ToolWording;
  chat?: ToolWording;
}>;

/**
 * The REST agent envelope nests the failure under `error`, while the chat tool envelope carries
 * `error.message` next to a top-level `details`, so the field paths a remediation names are part of
 * the surface's wording rather than of the meaning.
 */
const FIX_SQL_PREFIX = "Fix the sql string using error.message and any error.details.validationIssues, then ";
const FIX_REQUEST_PREFIX = "Fix the request using error.message and any error.details.validationIssues, then ";
const CHAT_FIX_SQL_PREFIX = "Fix the sql string using error.message and any details.validationIssues, then ";
const CHAT_FIX_REQUEST_PREFIX = "Fix the arguments using error.message and any details.validationIssues, then ";

const MEANING_WORDING: Readonly<Record<RemediationMeaning, MeaningWording>> = {
  sql_rejected: {
    rest: () => `${FIX_SQL_PREFIX}retry the same endpoint: POST /v1/agent/sql/query for reads or POST /v1/agent/sql/execute for writes. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.`,
    // Name get_guide on both tool surfaces as well as in its own description: this is the moment
    // the model needs the dialect, and the tool description it would have to recall that from was
    // loaded long before the failing call.
    mcp: ({ toolName }) => `${FIX_SQL_PREFIX}call the ${toolName} tool again. If the dialect itself is unclear, call get_guide with topic sql_dialect first instead of guessing.`,
    chat: ({ toolName }) => `${CHAT_FIX_SQL_PREFIX}call the ${toolName} tool again. If the dialect itself is unclear, call get_guide with topic sql_dialect first instead of guessing.`,
  },
  // The chat runs against the workspace its session is bound to and has no workspace tool, so it
  // never reaches this meaning and words nothing for it.
  workspace_selection_required: {
    rest: () => "Call GET /v1/agent/me, then GET /v1/agent/workspaces?limit=100. A first workspace is auto-provisioned for new users. If data.nextCursor is not null, continue with the same limit and cursor=data.nextCursor. If multiple workspaces exist, select one with POST /v1/agent/workspaces/{workspaceId}/select before calling POST /v1/agent/sql/query or POST /v1/agent/sql/execute.",
    mcp: ({ toolName }) => `This connection has no selected workspace. Call the list_workspaces tool to see the workspaces you can access (also embedded under error.details.workspaces when available), then call the ${toolName} tool again with the workspaceId argument set to the one you want.`,
  },
  review_schedule_stale: {
    shared: "The card's stored review time is at or after the current server time, so the scheduler cannot move forward from it. Reloading the card does not clear that; explain the conflict and review another card instead of submitting a rating for this one.",
  },
  review_already_recorded: {
    shared: "This review was already recorded, so nothing was stored again. Read the card's current schedule from error.details.reviewSchedule and move on; use a new reviewId only for a new learner review.",
  },
  commit_outcome_unknown: {
    rest: ({ operation }) => {
      if (operation === "review_submission") {
        return "Retry the identical review request with the same workspaceId, reviewId, cardId, and rating. Do not advance until the result is confirmed.";
      }

      if (operation === "multipart_completion") {
        return "The completion database commit outcome is unknown and rollback is not guaranteed. Reload or replay the exact completion with the same session and parts to observe canonical state before taking any other action; do not abort or replace the upload.";
      }

      if (operation === "multipart_abort") {
        return "The abort database commit outcome is unknown and rollback is not guaranteed. Reload the upload session and media asset before retrying the same abort, and stop if canonical state is already terminal.";
      }

      return "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.";
    },
    mcp: ({ toolName, operation }) => (operation === "review_submission"
      ? "Retry submit_review with the identical workspaceId, reviewId, rating, and cardId. Do not advance until the result is confirmed."
      : `The previous mutation's outcome could not be confirmed. Do not blindly re-run it: first call sql_query with a SELECT to check whether the change already applied, and only call the ${toolName} tool again if the change is confirmed absent.`),
    chat: ({ toolName }) => `The previous mutation's outcome could not be confirmed. Do not blindly re-run it: first call the ${toolName} tool with a SELECT to check whether the change already applied, and only run the write again if the change is confirmed absent.`,
  },
  service_temporarily_unavailable: {
    rest: ({ operation }) => {
      if (operation === "multipart_completion") {
        return "Reload the upload session and media asset because the database outcome may be unknown. Do not assume rollback. After the Retry-After delay, retry the same completion with unchanged session and parts only if canonical state does not already show completion or durable processing.";
      }

      if (operation === "multipart_abort") {
        return "Reload the upload session and media asset because abort admission or closure may have committed. Do not assume rollback. After the Retry-After delay, retry the same abort only if canonical state is not already terminal.";
      }

      return "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
    },
    mcp: ({ toolName }) => `The service is temporarily unavailable. Retry the same ${toolName} tool call after a short delay without changing the request.`,
    chat: ({ toolName }) => `The service is temporarily unavailable. Retry the same ${toolName} tool call once after a short delay without changing the request, and tell the user if it fails again.`,
  },
};

const RETRY_UNCHANGED_REST_REQUEST = "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.";
const RELOAD_REST_UPLOAD_STATE_AFTER_MISMATCH = "Reload the upload session and media asset before taking another action. Do not blindly replay the mismatched completion or assume rollback; if no completed asset exists, close the stale session as allowed and create a fresh upload with the correct bytes and metadata.";
const REST_API_KEY_AUTHORIZATION = "Use a valid non-revoked API key in the Authorization header as: ApiKey $FLASHCARDS_OPEN_SOURCE_API_KEY after exporting it once. If needed, restart from GET /v1/agent.";

/**
 * Codes only the REST agent API can raise or act on: multipart upload sessions, ApiKey
 * authorization, workspace ids carried in a request URL, and the transient media-write fences.
 * No tool surface has an operation that reaches them, so they are worded once, here, and fall
 * through to the generic wording everywhere else.
 */
const REST_CODE_INSTRUCTIONS: Readonly<Record<string, RestWording | undefined>> = {
  AUTH_VERIFICATION_TEMPORARILY_UNAVAILABLE: () => "Retry the same authenticated request after the Retry-After delay without changing the token. If it keeps failing, sign in again and use requestId when debugging.",
  MEDIA_BLOB_LIFECYCLE_BUSY: ({ operation }) => {
    if (operation === "multipart_completion") {
      return "Blob cleanup temporarily fenced database application after storage work may have occurred. Do not assume rollback. Wait for Retry-After, then retry the same completion with the unchanged session and parts.";
    }

    if (operation === "multipart_abort") {
      return "S3 abort completed, but database closure is temporarily fenced and the session may remain aborting. Wait for Retry-After, reload the session, and retry the same abort if it is not already terminal.";
    }

    return RETRY_UNCHANGED_REST_REQUEST;
  },
  MEDIA_ASSET_STORAGE_UNAVAILABLE: ({ operation }) => {
    if (operation === "multipart_completion") {
      return "Multipart completion or promotion failed with an unknown storage mutation outcome. Do not assume rollback, abort, or replace the upload. Retry the same completion with the unchanged session and parts after any Retry-After delay.";
    }

    if (operation === "multipart_abort") {
      return "Abort was admitted before storage failed, so the session may be aborting and the S3 outcome may be unknown. Do not assume rollback. Reload the session, then retry the same abort after any Retry-After delay if it is not already terminal.";
    }

    return "The storage mutation outcome may be unknown. Do not assume rollback. Retry the unchanged request after any Retry-After delay and use requestId if it fails again.";
  },
  MEDIA_ASSET_WRITER_BUSY: () => RETRY_UNCHANGED_REST_REQUEST,
  MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED: () => RETRY_UNCHANGED_REST_REQUEST,
  MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED: () => "Wait for the Retry-After delay, then retry the same completion with the unchanged session and parts. Do not abort the session or create a replacement upload.",
  MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED: () => "This legacy upload session cannot complete durably. Abort it if it is still open, then create a fresh multipart upload session, upload the bytes again, and complete the new session.",
  MEDIA_ASSET_UPLOAD_SESSION_EXPIRED: () => "This expired upload session has already been closed. Create a fresh multipart upload session, upload the bytes again, and complete the new session; do not retry this completion request.",
  MEDIA_ASSET_UPLOAD_SESSION_COMPLETED: () => "Completion already won for this upload session. Reload and use the completed media asset, or replay the original completion only to retrieve its idempotent result. Do not retry abort or create a replacement upload.",
  MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT: () => "Reload the upload session and media asset to determine their canonical state before choosing the next action. Do not blindly replay completion or abort, and do not assume earlier storage work was rolled back.",
  MEDIA_ASSET_UPLOAD_MISMATCH: () => RELOAD_REST_UPLOAD_STATE_AFTER_MISMATCH,
  MEDIA_ASSET_UPLOAD_PROOF_MISMATCH: () => RELOAD_REST_UPLOAD_STATE_AFTER_MISMATCH,
  MEDIA_ASSET_UPLOAD_NOT_FOUND: () => "Reload the upload session and media asset before taking another action. Do not blindly replay or assume rollback; if no completion is pending or applied, create a fresh upload session and upload the bytes again.",
  MEDIA_ASSET_UPLOAD_SESSION_ACCESS_DENIED: () => "Reload account, workspace access, upload-session, and media-asset state. Do not retry completion until access is restored, and do not assume earlier storage work was rolled back.",
  WORKSPACE_ACCESS_DENIED: ({ operation }) => {
    if (operation === "multipart_completion") {
      return "Reload account and workspace access, the upload session, and the media asset. Completion may have performed storage work before access changed, so do not assume rollback. Retry completion only after access is restored and canonical state is known.";
    }

    if (operation === "multipart_abort") {
      return "Reload account and workspace access, the upload session, and the media asset. Access loss may have occurred before abort admission or after admitted S3 work, so do not assume rollback. Retry abort only after access is restored and canonical state is known.";
    }

    return "Reload account and workspace access before retrying. Do not assume an in-flight mutation was rolled back.";
  },
  MEDIA_ASSET_REPLICA_INVALID: () => "Reload the workspace replicas, upload session, and media asset before retrying with a currently accessible lastModifiedByReplicaId. Do not assume earlier storage work was rolled back.",
  MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS: ({ statusCode, operation }) => {
    if (operation === "multipart_completion") {
      return statusCode === 409
        ? "Expiry cleanup was denied because completion is being durably reconciled; abort admission made no database or S3 mutation. Wait for Retry-After, then retry the unchanged completion with the same session and parts."
        : "Completion has a live writer or was accepted for durable processing. Wait for Retry-After, then retry the unchanged completion with the same session and parts; do not abort or replace the upload.";
    }

    if (operation === "multipart_abort") {
      return "Abort admission was denied and this abort made no database or S3 mutation. Wait for Retry-After, then retry completion or session creation to observe the durable outcome; do not start a replacement byte upload or retry abort while completion remains active.";
    }

    return "Wait for the Retry-After delay, then retry the unchanged completion or session creation request. Do not abort the session or start a replacement byte upload.";
  },
  MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS: () => "Wait for the Retry-After delay, then retry the unchanged session creation request. Do not start a parallel byte upload.",
  MEDIA_ASSET_UPLOAD_SESSION_NOT_FOUND: ({ operation }) => {
    if (operation === "multipart_completion") {
      return "Reload canonical upload-session and media-asset state and verify the sessionId. Correct a wrong identifier; if the stale session no longer exists, create a fresh session only after confirming no completion is pending or applied. Do not blindly retry this completion.";
    }

    if (operation === "multipart_abort") {
      return "Reload canonical upload-session and media-asset state and verify the sessionId. Correct a wrong identifier, or stop retrying abort if the stale session no longer exists.";
    }

    return "Reload canonical upload-session and media-asset state and verify the sessionId before retrying or creating replacement state.";
  },
  AUTH_UNAUTHORIZED: () => REST_API_KEY_AUTHORIZATION,
  AGENT_API_KEY_INVALID: () => REST_API_KEY_AUTHORIZATION,
  WORKSPACE_ID_REQUIRED: () => "Provide a valid workspaceId UUID in the request URL, then retry the action.",
  WORKSPACE_ID_INVALID: () => "Provide a valid workspaceId UUID in the request URL, then retry the action.",
};

/**
 * Every code lookup goes through this: a bare `TABLE[code]` walks the prototype chain, so a code
 * such as `toString` would resolve to an inherited `Object.prototype` method and be rendered to the
 * model as remediation text.
 */
function readCodeTable<Value>(
  table: Readonly<Record<string, Value | undefined>>,
  code: string,
): Value | undefined {
  return Object.hasOwn(table, code) ? table[code] : undefined;
}

/**
 * A code belongs to exactly one of the two tables above: carrying both would silently hide its
 * meaning from REST while every other surface kept rendering it. Both tables are static, so the
 * check runs at import and fails the first load rather than one request.
 */
function requireDisjointRemediationTables(): void {
  for (const code of Object.keys(REST_CODE_INSTRUCTIONS)) {
    if (readCodeTable(MEANING_BY_CODE, code) !== undefined) {
      throw new Error(
        `Remediation code ${code} carries both a shared meaning and REST-only wording; keep it in one table.`,
      );
    }
  }
}

/**
 * Every field of `MeaningWording` is optional, so a meaning declared as `{}` would type-check and
 * then render the generic status wording on all three surfaces - the same silent hiding the check
 * above exists to prevent, one level down. It is checked here for the same reason and at the same
 * time rather than as a four-variant union type. A blank `shared` is worse than `{}`: every
 * renderer prefers it over its generic status wording, so it would ship an empty `instructions`
 * string to whichever surfaces have no wording of their own. Both are rejected here.
 */
function requireWordedRemediationMeanings(): void {
  for (const [meaning, wording] of Object.entries(MEANING_WORDING)) {
    if (wording.shared !== undefined && wording.shared.trim() === "") {
      throw new Error(
        `Remediation meaning ${meaning} words a blank shared string; write the wording or drop the field.`,
      );
    }

    if (
      wording.shared === undefined
      && wording.rest === undefined
      && wording.mcp === undefined
      && wording.chat === undefined
    ) {
      throw new Error(
        `Remediation meaning ${meaning} words no surface; give it a shared wording or at least one surface wording.`,
      );
    }
  }
}

requireDisjointRemediationTables();
requireWordedRemediationMeanings();

function resolveMeaningWording(code: string | null): MeaningWording | undefined {
  const meaning = code === null ? undefined : readCodeTable(MEANING_BY_CODE, code);

  return meaning === undefined ? undefined : MEANING_WORDING[meaning];
}

function renderRestInstructions(
  code: string | null,
  context: RestRemediationContext,
): string {
  const codeWording = code === null ? undefined : readCodeTable(REST_CODE_INSTRUCTIONS, code);
  if (codeWording !== undefined) {
    return codeWording(context);
  }

  const wording = resolveMeaningWording(code);
  if (wording?.rest !== undefined) {
    return wording.rest(context);
  }

  if (wording?.shared !== undefined) {
    return wording.shared;
  }

  if (context.statusCode >= 500) {
    return "Retry the same request once. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
  }

  if (context.statusCode === 404) {
    return "Verify that the referenced resource id exists in the selected workspace, then retry only after correcting the id.";
  }

  if (context.statusCode >= 400) {
    return `${FIX_REQUEST_PREFIX}retry the same request.`;
  }

  return "If the issue persists, reload account context from GET /v1/agent/me or restart from GET /v1/agent.";
}

/**
 * An MCP client authenticates with an OAuth Bearer token and invokes tools, so it can neither set
 * an `ApiKey` Authorization header nor call a `/v1/agent/*` route: every wording here is something
 * it can act on, and it names the failing tool so the model retries the correct one.
 */
function renderMcpInstructions(
  code: string | null,
  context: ToolRemediationContext,
): string {
  const wording = resolveMeaningWording(code);
  if (wording?.mcp !== undefined) {
    return wording.mcp(context);
  }

  if (wording?.shared !== undefined) {
    return wording.shared;
  }

  return context.statusCode >= 500
    ? `Retry the ${context.toolName} tool once; if it fails again treat it as a server-side error and stop changing the request.`
    : `${FIX_REQUEST_PREFIX}call the ${context.toolName} tool again.`;
}

/**
 * The chat model runs inside a user's conversation: it has no connector to re-authorize and no way
 * to wait out a delay, so a remediation it cannot complete ends in telling the user instead.
 */
function renderChatInstructions(
  code: string | null,
  context: ToolRemediationContext,
): string {
  const wording = resolveMeaningWording(code);
  if (wording?.chat !== undefined) {
    return wording.chat(context);
  }

  if (wording?.shared !== undefined) {
    return wording.shared;
  }

  if (context.statusCode >= 500) {
    return `Retry the ${context.toolName} tool once. If it fails again, stop retrying and tell the user the request failed on our side.`;
  }

  if (context.statusCode === 404) {
    return `Verify that the referenced id exists in this workspace with a SELECT, then call the ${context.toolName} tool again only after correcting it.`;
  }

  if (context.statusCode === 403) {
    return "The account cannot access that data, so the same call will be denied again. Tell the user what was denied instead of retrying.";
  }

  return `${CHAT_FIX_REQUEST_PREFIX}call the ${context.toolName} tool again.`;
}

/**
 * Remediation text for one failing call: the surface's own wording for the code if it has one,
 * then the code's meaning worded for that surface, then the meaning's surface-neutral wording,
 * then the surface's generic wording for the status.
 */
export function createAgentRemediationInstructions(
  code: string | null,
  statusCode: number,
  call: AgentRemediationCall,
): string {
  const operation = resolveFailingOperation(call);
  switch (call.surface) {
    case "rest":
      return renderRestInstructions(code, { statusCode, operation });
    case "mcp":
      return renderMcpInstructions(code, { toolName: call.toolName, statusCode, operation });
    case "chat":
      return renderChatInstructions(code, { toolName: call.toolName, statusCode, operation });
  }
}
