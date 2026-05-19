import type { Handler } from "hono";
import type { AppEnv } from "../../app";
import {
  type ChatComposerSuggestionsLocale,
  localizeInitialChatComposerSuggestions,
  type ChatComposerSuggestion,
} from "../composerSuggestions";
import { getChatConfig } from "../config";
import type { ChatStopResponse } from "../contract";
import {
  getBackendTraceCarrier,
  startBackendSpan,
} from "../../observability/sentry";
import { parseOptionalWorkspaceIdParam } from "../../server/requestContext";
import { parseJsonBody } from "../../server/requestParsing";
import {
  parseChatPageQuery,
  parseChatRequestBody,
  parseNewChatRequestBody,
  parseOptionalSessionIdQuery,
  parseStopChatRequestBody,
} from "./contract";
import {
  loadSupportedRequestContext,
  type ChatRouteDependencies,
} from "./dependencies";
import {
  assertRunningSnapshotInvariant,
  buildConversationEnvelopeWithActiveRun,
  buildPaginatedConversationEnvelopeWithActiveRun,
  buildStartConversationEnvelope,
} from "./envelopes";
import { mapStoreError } from "./errors";
import { readChatResumeDiagnosticsHeaders } from "./diagnostics";
import type {
  ChatRunStopState,
  PreparedChatRun,
} from "../runs";
import {
  ChatSessionNotFoundError,
  type ChatSessionSnapshot,
} from "../store";

type ChatNewResponse = Readonly<{
  ok: true;
  sessionId: string;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ReturnType<typeof getChatConfig>;
}>;

function buildChatNewResponse(
  snapshot: ChatSessionSnapshot,
  uiLocale: ChatComposerSuggestionsLocale | undefined,
): ChatNewResponse {
  return {
    ok: true,
    sessionId: snapshot.sessionId,
    composerSuggestions: localizeInitialChatComposerSuggestions(
      snapshot.composerSuggestions,
      uiLocale,
    ),
    chatConfig: getChatConfig(),
  };
}

export function createGetChatHandler(dependencies: ChatRouteDependencies): Handler<AppEnv> {
  return async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      dependencies,
    );
    const explicitWorkspaceId = parseOptionalWorkspaceIdParam(context.req.query("workspaceId") ?? undefined);
    const workspaceId = await dependencies.resolveAccessibleChatWorkspaceIdFn(requestContext, explicitWorkspaceId);
    const sessionId = parseOptionalSessionIdQuery(context.req.query("sessionId") ?? undefined);
    const pageQuery = parseChatPageQuery(
      context.req.query("limit") ?? undefined,
      context.req.query("before") ?? undefined,
    );
    const resumeDiagnostics = readChatResumeDiagnosticsHeaders(context.req.raw);
    const requestId = context.get("requestId") ?? null;
    const traceContext = getBackendTraceCarrier();

    if (pageQuery !== null) {
      try {
        const result = await dependencies.getRecoveredPaginatedSessionFn(
          requestContext.userId,
          workspaceId,
          sessionId,
          pageQuery.limit,
          pageQuery.beforeCursor,
        );
        return context.json(await buildPaginatedConversationEnvelopeWithActiveRun(
          result,
          requestContext.userId,
          workspaceId,
          requestId,
          traceContext,
          dependencies.createChatLiveStreamEnvelopeFn,
          dependencies.resolveLiveCursorFn,
          context.req.raw,
          resumeDiagnostics,
          dependencies.listChatMessagesLatestFn,
        ));
      } catch (error) {
        return mapStoreError(error);
      }
    }

    try {
      const snapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        sessionId,
      );
      await assertRunningSnapshotInvariant(
        context.req.raw,
        resumeDiagnostics,
        requestId,
        snapshot,
        requestContext.userId,
        workspaceId,
        dependencies.listChatMessagesLatestFn,
      );
      return context.json(await buildConversationEnvelopeWithActiveRun(
        snapshot,
        requestContext.userId,
        workspaceId,
        requestId,
        traceContext,
        dependencies.createChatLiveStreamEnvelopeFn,
        dependencies.resolveLiveCursorFn,
        context.req.raw,
        resumeDiagnostics,
        dependencies.listChatMessagesLatestFn,
      ));
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createPostChatHandler(dependencies: ChatRouteDependencies): Handler<AppEnv> {
  return async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      dependencies,
    );
    const body = parseChatRequestBody(await parseJsonBody(context.req.raw));
    const workspaceId = await dependencies.resolveAccessibleChatWorkspaceIdFn(requestContext, body.workspaceId);
    const resumeDiagnostics = readChatResumeDiagnosticsHeaders(context.req.raw);
    const requestId = context.get("requestId") ?? null;
    const traceContext = getBackendTraceCarrier();
    context.header("X-Chat-Request-Id", body.clientRequestId);

    let preparedRun: PreparedChatRun;
    try {
      preparedRun = await startBackendSpan("chat.prepare_run", "app.chat", () => dependencies.prepareChatRunFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
        body.content,
        body.clientRequestId,
        body.timezone,
        // Older clients still omit uiLocale, so keep the null fallback until
        // every supported app version has migrated to the explicit field.
        body.uiLocale ?? null,
      ));
    } catch (error) {
      return mapStoreError(error);
    }

    if (preparedRun.shouldInvokeWorker) {
      await startBackendSpan("chat.worker.invoke", "faas.invoke", () => dependencies.invokeChatWorkerFn({
        runId: preparedRun.runId,
        userId: requestContext.userId,
        workspaceId,
        routeRequestId: requestId,
        chatRequestId: body.clientRequestId,
        sessionId: preparedRun.sessionId,
      }));
    }

    try {
      const snapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        preparedRun.sessionId,
      );

      return context.json(await buildStartConversationEnvelope({
        preparedRun,
        snapshot,
        userId: requestContext.userId,
        workspaceId,
        requestId,
        traceContext,
        createChatLiveStreamEnvelopeFn: dependencies.createChatLiveStreamEnvelopeFn,
        resolveLiveCursorFn: dependencies.resolveLiveCursorFn,
        interruptPreparedChatRunFn: dependencies.interruptPreparedChatRunFn,
        request: context.req.raw,
        diagnostics: resumeDiagnostics,
        listChatMessagesLatestFn: dependencies.listChatMessagesLatestFn,
      }));
    } catch (error) {
      return mapStoreError(error);
    }
  };
}

export function createPostChatNewHandler(dependencies: ChatRouteDependencies): Handler<AppEnv> {
  return async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      dependencies,
    );
    const body = parseNewChatRequestBody(await parseJsonBody(context.req.raw));
    const workspaceId = await dependencies.resolveAccessibleChatWorkspaceIdFn(requestContext, body.workspaceId);

    // Preferred modern flow: clients send an explicit client-generated
    // sessionId. First-party clients at 1.3.0 already follow that flow.
    // When an explicit id is present, this route is idempotent: create exactly
    // that session if it does not exist yet, otherwise return the existing
    // session unchanged. The omitted-sessionId path below stays temporarily
    // for backward compatibility with older clients and should be removed in a
    // future legacy chat cleanup.
    if (body.sessionId !== undefined) {
      let existingSessionId: string | null;
      try {
        existingSessionId = await dependencies.getChatSessionIdFn(
          requestContext.userId,
          workspaceId,
          body.sessionId,
        );
      } catch (error) {
        return mapStoreError(error);
      }

      if (existingSessionId === null) {
        try {
          const createdSessionId = await dependencies.createFreshChatSessionFn(
            requestContext.userId,
            workspaceId,
            body.sessionId,
            body.uiLocale ?? null,
          );
          const createdSnapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
            requestContext.userId,
            workspaceId,
            createdSessionId,
          );

          return context.json(buildChatNewResponse(createdSnapshot, body.uiLocale) satisfies ChatNewResponse);
        } catch (error) {
          return mapStoreError(error);
        }
      }

      try {
        const existingSnapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
          requestContext.userId,
          workspaceId,
          existingSessionId,
        );

        return context.json(buildChatNewResponse(existingSnapshot, body.uiLocale) satisfies ChatNewResponse);
      } catch (error) {
        return mapStoreError(error);
      }
    }

    let snapshot: ChatSessionSnapshot;
    try {
      snapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (snapshot.messages.length === 0 && snapshot.runState === "idle") {
      return context.json(buildChatNewResponse(snapshot, body.uiLocale) satisfies ChatNewResponse);
    }

    let newSnapshot: ChatSessionSnapshot;
    try {
      const newSessionId = await dependencies.rolloverToFreshChatSessionFn(
        requestContext.userId,
        workspaceId,
        snapshot.sessionId,
        body.uiLocale ?? null,
      );
      newSnapshot = await dependencies.getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        newSessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    return context.json(buildChatNewResponse(newSnapshot, body.uiLocale) satisfies ChatNewResponse);
  };
}

export function createPostChatStopHandler(dependencies: ChatRouteDependencies): Handler<AppEnv> {
  return async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      dependencies,
    );
    const body = parseStopChatRequestBody(await parseJsonBody(context.req.raw));
    const workspaceId = await dependencies.resolveAccessibleChatWorkspaceIdFn(requestContext, body.workspaceId);

    let sessionId: string | null;
    try {
      sessionId = await dependencies.getChatSessionIdFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (sessionId === null) {
      return mapStoreError(new ChatSessionNotFoundError(body.sessionId));
    }

    const stopState: ChatRunStopState = await dependencies.requestChatRunCancellationFn(
      requestContext.userId,
      workspaceId,
      sessionId,
      body.runId ?? null,
    );

    return context.json({
      sessionId: stopState.sessionId,
      // First-party clients at 1.3.0 no longer depend on these duplicate
      // legacy stop-response fields. Keep returning them temporarily for older
      // released clients and remove them in a future legacy chat cleanup.
      conversationScopeId: stopState.sessionId,
      runId: stopState.runId,
      stopped: stopState.stopped,
      stillRunning: stopState.stillRunning,
    } satisfies ChatStopResponse);
  };
}
