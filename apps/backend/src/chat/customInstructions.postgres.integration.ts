import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import type OpenAI from "openai";
import pg from "pg";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { createAgentApiKeyForUser } from "../agent/apiKeys";
import { resetAuthConfigForTests } from "../auth/config";
import { ensureCognitoUserProfile, type UserProfile } from "../auth/ensureUser";
import { transactionWithUserScope } from "../database";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  createGuestSession,
  prepareGuestUpgrade,
} from "../guestAuth";
import { browserGuestCookieName } from "../guestAuth/browser/cookie";
import { createBrowserGuestSession, forgetBrowserGuestSession } from "../guestAuth/browser/session";
import { createChatRoutes } from "../routes/chat";
import { createWorkspaceInExecutor } from "../workspaces/create";
import type { ChatActiveRun } from "./contract";
import { claimChatRun, prepareChatRun } from "./runs/lifecycleService";
import { withProviderTestServer, writeJsonResponse, writeRawResponse } from "./cardImages/provider/providerTestServer.testSupport";
import { setOpenAIBaseUrlForTests } from "./openai/client";
import { createAssistantMessageItem, createResponse } from "./openai/loop/loop.testSupport";
import { handleChatWorkerEvent } from "./worker";
import { createRoutesWithHttpErrorJson } from "./tests/routes/testSupport";

test("workspace chat instructions use the authenticated workspace and the exact initiating guest session", async (t) => {
  const previousTestEnv = new Map<string, string | undefined>();
  t.after(() => {
    for (const [name, previous] of previousTestEnv) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });
  const setTestEnv = (name: string, value: string): void => {
    if (!previousTestEnv.has(name)) previousTestEnv.set(name, process.env[name]);
    process.env[name] = value;
  };
  setTestEnv("AUTH_MODE", "cognito");
  setTestEnv("COGNITO_USER_POOL_ID", "us-east-1_test");
  setTestEnv("COGNITO_CLIENT_ID", "test-client");
  setTestEnv("BACKEND_CSRF_SECRET_ARN", "test-chat-csrf");
  setTestEnv("OPENAI_API_KEY", "chat-instructions-test-platform-key");
  resetAuthConfigForTests();
  t.after(resetAuthConfigForTests);
  t.after(() => setOpenAIBaseUrlForTests(null));

  const testCsrfSecret = "chat-instructions-test-csrf-key";
  const origin = "https://app.example.test";
  t.mock.method(SecretsManagerClient.prototype, "send", async (command: GetSecretValueCommand) => {
    assert.equal(command.input.SecretId, "test-chat-csrf");
    return { SecretString: testCsrfSecret };
  });
  const registeredTokens = new Map<string, string>();
  t.mock.method(CognitoJwtVerifier, "create", () => ({
    verify: async (token: string) => {
      const subject = registeredTokens.get(token);
      assert.ok(subject);
      return { sub: subject, email: `${subject}@example.test`, auth_time: Math.floor(Date.now() / 1000) };
    },
  }));

  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const accountTokens = new Map<string, string>();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const routes = createRoutesWithHttpErrorJson();
  routes.route("/", createChatRoutes({
    allowedOrigins: [origin],
    invokeChatWorkerFn: async () => undefined,
    createChatLiveStreamEnvelopeFn: async () => ({
      url: "https://example.test/chat/live",
      authorization: "Live test",
      expiresAt: Date.now() + 60_000,
    }),
  }));

  const nativeHeaders = (token: string): Record<string, string> => ({
    "content-type": "application/json",
    authorization: `Guest ${token}`,
  });
  const cookieHeaders = (name: string, token: string): Record<string, string> => ({
    "content-type": "application/json",
    cookie: `${name}=${token}`,
    origin,
    "x-csrf-token": createHmac("sha256", testCsrfSecret).update(token).digest("base64url"),
  });
  const registerAccountToken = (userId: string, subject: string): void => {
    const token = randomUUID();
    accountTokens.set(userId, token);
    registeredTokens.set(token, subject);
  };
  const registeredHeaders = (userId: string): Record<string, string> => {
    const token = accountTokens.get(userId);
    assert.ok(token);
    return cookieHeaders("session", token);
  };
  const call = async (
    method: "GET" | "POST", userId: string, workspaceId: string, body?: string,
  ): Promise<Readonly<{ status: number; json: Record<string, unknown> }>> => {
    const response = await routes.request(`/workspaces/${workspaceId}/chat-instructions`, {
      method,
      headers: registeredHeaders(userId),
      ...(body === undefined ? {} : { body }),
    });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  const save = (userId: string, workspaceId: string, value: string | null) =>
    call("POST", userId, workspaceId, JSON.stringify({ customInstructions: value }));
  const expectInstructions = async (response: Response, expected: string | null): Promise<Record<string, unknown>> => {
    const json = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200, JSON.stringify(json));
    assert.equal(json.customInstructions, expected);
    return json;
  };
  const expectCode = async (response: Response, status: number, code: string | null): Promise<void> => {
    assert.equal(response.status, status);
    assert.equal(((await response.json()) as Record<string, unknown>).code, code);
  };
  const sendTurn = async (
    headers: Readonly<Record<string, string>>,
    workspaceId: string,
    sessionId: string,
    clientRequestId: string,
  ): Promise<Response> => routes.request("/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId, sessionId, clientRequestId,
      content: [{ type: "text", text: "Hello" }],
      timezone: "UTC",
    }),
  });
  const create = async (accountId: string): Promise<string> => {
    const id = await transactionWithUserScope({ userId: accountId }, (executor) =>
      createWorkspaceInExecutor(executor, accountId, { name: "Personal", cause: "explicit" }));
    workspaceIds.push(id);
    return id;
  };
  const createAccount = async (): Promise<UserProfile> => {
    const subject = randomUUID();
    const profile = await ensureCognitoUserProfile(subject, `${subject}@example.test`);
    registerAccountToken(profile.userId, subject);
    userIds.push(profile.userId);
    assert.ok(profile.selectedWorkspaceId);
    workspaceIds.push(profile.selectedWorkspaceId);
    return profile;
  };
  const isUnusedStarter = async (workspaceId: string): Promise<boolean> =>
    (await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaceId])).rows[0].unused;
  const storedValue = async (workspaceId: string): Promise<string | null> =>
    (await owner.query("SELECT custom_instructions FROM ai.workspace_chat_instructions WHERE workspace_id = $1",
      [workspaceId])).rows[0]?.custom_instructions ?? null;

  try {
    await owner.connect();
    const { userId: ownerId } = await createAccount();
    const { userId: memberId } = await createAccount();
    const { userId: starterUserId, selectedWorkspaceId: starter } = await createAccount();
    assert.ok(starter);
    const shared = await create(ownerId);
    const destination = await create(ownerId);
    await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [shared, memberId]);

    assert.deepEqual(await call("GET", ownerId, shared), { status: 200, json: { customInstructions: null, maxLength: 1500, canEdit: true } });
    assert.deepEqual(await save(ownerId, shared, "  Answer in German.\n"), {
      status: 200, json: { customInstructions: "Answer in German.", maxLength: 1500, canEdit: true },
    });
    const memberToken = accountTokens.get(memberId);
    assert.ok(memberToken);
    const memberInstructions = await expectInstructions(await routes.request(`/workspaces/${shared}/chat-instructions`, {
      headers: { authorization: `Bearer ${memberToken}` },
    }), "Answer in German.");
    assert.equal(memberInstructions.canEdit, false);
    assert.equal((await save(memberId, shared, "Mine")).json.code, "WORKSPACE_OWNER_REQUIRED");
    assert.equal((await save(memberId, shared, null)).json.code, "WORKSPACE_OWNER_REQUIRED");
    assert.deepEqual((await call("GET", ownerId, destination)).json, {
      customInstructions: null, maxLength: 1500, canEdit: true,
    });
    assert.equal((await call("GET", starterUserId, shared)).json.code, "WORKSPACE_NOT_FOUND");
    assert.equal((await call("GET", ownerId, "not-a-uuid")).json.code, "WORKSPACE_ID_INVALID");
    const { apiKey } = await createAgentApiKeyForUser(ownerId, "Instruction boundary test");
    await expectCode(await routes.request(`/workspaces/${shared}/chat-instructions`, {
      headers: { authorization: `ApiKey ${apiKey}` },
    }), 403, "AI_CHAT_V2_HUMAN_AUTH_REQUIRED");
    assert.equal((await save(ownerId, shared, "é".repeat(1501))).json.code, "CHAT_CUSTOM_INSTRUCTIONS_TOO_LONG");
    assert.equal((await save(ownerId, shared, "a\u0000b")).json.code, "CHAT_CUSTOM_INSTRUCTIONS_INVALID");
    assert.equal((await call("POST", ownerId, shared, "{\"customInstructions\":\"\\ud800\"}")).json.code,
      "CHAT_CUSTOM_INSTRUCTIONS_INVALID");
    assert.equal((await call("POST", ownerId, shared, "{}")).json.code, "CHAT_CUSTOM_INSTRUCTIONS_INVALID");
    // Code points, not UTF-16 units, matching the table's char_length CHECK.
    const emoji = "😀".repeat(1500);
    assert.equal((await save(ownerId, shared, emoji)).status, 200);
    assert.equal(await storedValue(shared), emoji);
    assert.equal((await save(ownerId, shared, "Answer in German.")).status, 200);

    const chat = await routes.request(`/chat?workspaceId=${shared}`, { headers: registeredHeaders(memberId) });
    assert.equal(chat.status, 200);
    assert.equal(((await chat.json()) as Record<string, unknown>).customInstructions, "Answer in German.");
    const [sessionId, runId, assistantItemId] = [randomUUID(), randomUUID(), randomUUID()];
    await owner.query(
      "INSERT INTO ai.chat_sessions(session_id,user_id,workspace_id,status,active_run_id) VALUES ($1,$2,$3,'running',$4)",
      [sessionId, ownerId, shared, runId],
    );
    await owner.query(
      "INSERT INTO ai.chat_items(item_id,session_id,item_kind,state,payload) VALUES ($1,$2,'message','in_progress',$3::jsonb)",
      [assistantItemId, sessionId, JSON.stringify({ role: "assistant", content: [] })],
    );
    await owner.query(
      `INSERT INTO ai.chat_runs(run_id,session_id,assistant_item_id,status,request_id,model_id,reasoning_effort,timezone,
         turn_input,initiating_auth_is_signed_in)
       VALUES ($1,$2,$3,'queued',$4,'gpt-5.6-terra','xhigh','UTC','[]'::jsonb,true)`,
      [runId, sessionId, assistantItemId, randomUUID()],
    );
    assert.equal((await claimChatRun(ownerId, shared, runId))?.customInstructions, "Answer in German.");

    assert.equal(await isUnusedStarter(starter), true);
    assert.equal((await save(starterUserId, starter, "Brief answers")).status, 200);
    assert.equal(await isUnusedStarter(starter), false);
    assert.deepEqual((await save(starterUserId, starter, "   ")).json, { customInstructions: null, maxLength: 1500, canEdit: true });
    assert.equal(await storedValue(starter), null);
    assert.equal(await isUnusedStarter(starter), true);
    assert.equal((await save(starterUserId, starter, "Use bullet points.")).status, 200);
    assert.deepEqual(await save(starterUserId, starter, null), {
      status: 200, json: { customInstructions: null, maxLength: 1500, canEdit: true },
    });
    assert.equal(await storedValue(starter), null);

    const legacyWeb = await createGuestSession("web", null);
    userIds.push(legacyWeb.userId);
    workspaceIds.push(legacyWeb.workspaceId);
    await expectCode(await routes.request(`/workspaces/${legacyWeb.workspaceId}/chat-instructions`, {
      headers: nativeHeaders(legacyWeb.guestToken),
    }), 403, "GUEST_WEB_PLATFORM_UNSUPPORTED");

    const browserGuest = await createBrowserGuestSession(randomUUID(), null);
    const nativeGuestForClaim = await createGuestSession("ios", null);
    const legacyNative = await createGuestSession(null, null);
    assert.equal((await authenticateGuestSession(legacyNative.guestToken)).platform, null);
    for (const guest of [nativeGuestForClaim, legacyNative, browserGuest]) {
      userIds.push(guest.userId);
      workspaceIds.push(guest.workspaceId);
      const credentialId = (await authenticateGuestSession(guest.guestToken)).sessionId;
      const browser = guest.purpose === "browser_product";
      const headers = browser ? cookieHeaders(browserGuestCookieName, guest.guestToken) : nativeHeaders(guest.guestToken);
      const settingsPath = `/workspaces/${guest.workspaceId}/chat-instructions`;
      const scopeQuery = browser ? `expectedAccountId=${guest.userId}&expectedAuthKind=guest` : "";
      const scopedSettingsPath = `${settingsPath}?${scopeQuery}`;
      const instructions = `Guest preferences for ${guest.purpose}`;
      const body = JSON.stringify({ customInstructions: instructions });
      await expectInstructions(await routes.request(scopedSettingsPath, { headers }), null);
      if (browser) {
        await expectCode(await routes.request(scopedSettingsPath, {
          method: "POST", headers: { ...headers, origin: "https://cross-origin.example.test" }, body,
        }), 403, null);
        await expectCode(await routes.request(scopedSettingsPath, {
          method: "POST", headers: { ...headers, "x-csrf-token": "invalid-csrf" }, body,
        }), 403, "SESSION_CSRF_TOKEN_INVALID");
        await expectCode(await routes.request(settingsPath, { headers: nativeHeaders(guest.guestToken) }),
          401, "GUEST_AUTH_INVALID");
        const wrongKindQuery = `expectedAccountId=${guest.userId}&expectedAuthKind=registered`;
        for (const [method, path] of [
          ["GET", settingsPath], ["POST", settingsPath], ["GET", "/chat"], ["POST", "/chat/new"],
        ]) {
          await expectCode(await routes.request(`${path}?${wrongKindQuery}`, { method, headers }),
            409, "ACCOUNT_SCOPE_CHANGED");
        }
        assert.equal(await storedValue(guest.workspaceId), null);
      }
      const saved = await expectInstructions(await routes.request(scopedSettingsPath, {
        method: "POST", headers, body,
      }), instructions);
      assert.equal(saved.canEdit, true);
      await expectInstructions(await routes.request(scopedSettingsPath, { headers }), instructions);
      await expectCode(await routes.request(`/workspaces/${destination}/chat-instructions`, { headers }),
        404, "WORKSPACE_NOT_FOUND");
      await expectCode(await routes.request(`/chat?workspaceId=${destination}`, { headers }), 404, "WORKSPACE_NOT_FOUND");
      await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [shared, guest.userId]);
      const sharedSettings = `/workspaces/${shared}/chat-instructions`;
      assert.equal((await expectInstructions(await routes.request(sharedSettings, { headers }), "Answer in German.")).canEdit, false);
      await expectCode(await routes.request(sharedSettings, { method: "POST", headers, body }), 403, "WORKSPACE_OWNER_REQUIRED");

      const chatPath = `/chat?workspaceId=${guest.workspaceId}&${scopeQuery}`;
      for (const path of [chatPath, `${chatPath}&limit=7`]) {
        await expectInstructions(await routes.request(path, { headers }), instructions);
      }
      const sessionId = randomUUID();
      await expectInstructions(await routes.request(`/chat/new?${scopeQuery}`, {
        method: "POST", headers, body: JSON.stringify({ workspaceId: guest.workspaceId, sessionId }),
      }), instructions);

      const requestId = randomUUID();
      const turn = await expectInstructions(await sendTurn(headers, guest.workspaceId, sessionId, requestId), instructions);
      const run = turn.activeRun as ChatActiveRun | null;
      assert.ok(run);
      assert.equal(await claimChatRun(guest.userId, destination, run.runId), null);
      const claim = await claimChatRun(guest.userId, guest.workspaceId, run.runId);
      assert.equal(claim?.initiatingAuthIsSignedIn, false);
      assert.equal(claim?.initiatingGuestSessionId, credentialId);
      assert.equal(claim?.browserGuestAiTrial, browser);
      assert.equal(claim?.customInstructions, instructions);
      assert.ok(!JSON.stringify(turn).includes(credentialId));
    }

    const oldRun = await prepareChatRun(
      nativeGuestForClaim.userId, nativeGuestForClaim.workspaceId, randomUUID(), [{ type: "text", text: "Old turn" }],
      randomUUID(), "UTC", null, false, "ios", "ios", "phone", async () => undefined,
    );
    const oldRunClaim = await claimChatRun(nativeGuestForClaim.userId, nativeGuestForClaim.workspaceId, oldRun.runId);
    assert.ok(oldRunClaim);
    assert.equal(oldRunClaim.customInstructions, null);

    const nativeGuest = await createGuestSession("ios", null);
    const { userId: boundUserId, workspaceId: boundWorkspaceId } = nativeGuest;
    userIds.push(boundUserId);
    workspaceIds.push(boundWorkspaceId);
    const guestHeaders = nativeHeaders(nativeGuest.guestToken);
    const queuedTurn = await expectInstructions(await sendTurn(guestHeaders, boundWorkspaceId, randomUUID(), randomUUID()), null);
    const queuedRun = queuedTurn.activeRun as ChatActiveRun | null;
    assert.ok(queuedRun);
    const boundSubject = randomUUID();
    const boundEmail = `${boundSubject}@example.test`;
    const boundSettingsPath = `/workspaces/${boundWorkspaceId}/chat-instructions`;
    const nativeInstructions = "Give examples in every explanation.";
    const setNativeInstructions = async (customInstructions: string | null): Promise<Response> => routes.request(boundSettingsPath, {
      method: "POST", headers: guestHeaders, body: JSON.stringify({ customInstructions }),
    });
    await expectInstructions(await setNativeInstructions(nativeInstructions), nativeInstructions);
    const replaySessionId = randomUUID();
    const replayKey = "test-native-replay-key";
    const priorReply = "Earlier visible reply";
    await withProviderTestServer(async (request, number, response) => {
      assert.equal(request.authorization, `Bearer ${replayKey}`);
      const { input } = request.body as { input: Array<{ type: string }> };
      assert.equal(JSON.stringify(input).includes(nativeInstructions), number === 1);
      if (number === 2) {
        assert.equal(input[0]?.type, "compaction");
        assert.ok(input.some((item) => item.type === "reasoning"));
        assert.equal((await prepareGuestUpgrade(nativeGuest.guestToken, boundSubject, boundEmail)).mode, "bound");
        const upgraded = await completeGuestUpgrade(
          nativeGuest.guestToken,
          boundSubject,
          { type: "existing", workspaceId: boundWorkspaceId },
          {
            guestWorkspaceSyncedAndOutboxDrained: true,
            requiresGuestWorkspaceSyncedAndOutboxDrained: true,
            supportsDroppedEntities: true,
          },
        );
        assert.equal(upgraded.targetUserId, boundUserId);
        assert.equal(upgraded.targetWorkspaceId, boundWorkspaceId);
        writeJsonResponse(response, 400, "native-replay-overflow", {
          error: { message: "input exceeds context window", code: "context_length_exceeded", type: "invalid_request_error" },
        });
        return;
      }
      if (number !== 1) {
        assert.equal(number, 3);
        assert.ok(input.every((item) => item.type !== "compaction" && item.type !== "reasoning"));
        assert.ok(JSON.stringify(input).includes(priorReply));
      }
      const message = createAssistantMessageItem(priorReply);
      const output: ReadonlyArray<OpenAI.Responses.ResponseOutputItem> = number === 1 ? [
        { type: "compaction", id: "compaction-1", encrypted_content: "opaque-compaction" },
        { type: "reasoning", id: "reasoning-1", summary: [], encrypted_content: "opaque-reasoning" },
        message,
      ] : [message];
      const events = [
        { type: "response.output_text.delta", delta: priorReply, item_id: message.id, sequence_number: 1 },
        { type: "response.completed", response: createResponse(output, priorReply), sequence_number: 2 },
      ];
      writeRawResponse(response, 200, "native-replay-completed", "text/event-stream",
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    }, async (provider) => {
      setOpenAIBaseUrlForTests(provider.baseURL);
      const runGuestTurn = async (expectedInstructions: string | null): Promise<string> => {
        const requestId = randomUUID();
        const turn = await expectInstructions(await sendTurn(
          { ...guestHeaders, "x-openai-api-key": replayKey }, boundWorkspaceId, replaySessionId, requestId,
        ), expectedInstructions);
        const run = turn.activeRun as ChatActiveRun | null;
        assert.ok(run);
        await handleChatWorkerEvent({
          userId: boundUserId, workspaceId: boundWorkspaceId, runId: run.runId,
          sessionId: replaySessionId, chatRequestId: requestId, userOpenAIApiKey: replayKey,
        }, { lambdaRequestId: null, getRemainingTimeInMillis: () => 300_000 });
        return run.runId;
      };

      const initialRun = await runGuestTurn(nativeInstructions);
      await expectInstructions(await setNativeInstructions(null), null);
      const fencedRun = await runGuestTurn(null);
      assert.equal(provider.requests.length, 2);
      const graceRun = await runGuestTurn(null);
      assert.equal(provider.requests.length, 3);
      const { rows } = await owner.query<{ run_id: string; status: string }>(
        "SELECT run_id, status FROM ai.chat_runs WHERE run_id = ANY($1::uuid[])",
        [[initialRun, fencedRun, graceRun]],
      );
      assert.deepEqual(new Map(rows.map((row) => [row.run_id, row.status])),
        new Map([[initialRun, "completed"], [fencedRun, "failed"], [graceRun, "completed"]]));
    });
    registerAccountToken(boundUserId, boundSubject);
    const boundInstructions = "Use concise examples.";
    assert.equal((await save(boundUserId, boundWorkspaceId, boundInstructions)).status, 200);

    const accountHeaders = registeredHeaders(boundUserId);
    await expectCode(await routes.request(boundSettingsPath, { headers: guestHeaders }),
      403, "ACCOUNT_SIGN_IN_REQUIRED");
    await expectCode(await routes.request(boundSettingsPath, {
      method: "POST", headers: guestHeaders, body: JSON.stringify({ customInstructions: "Stale edit" }),
    }), 403, "ACCOUNT_SIGN_IN_REQUIRED");
    const bothCookies = { ...accountHeaders, cookie: `${accountHeaders.cookie}; ${browserGuestCookieName}=${browserGuest.guestToken}` };
    const previousGuestQuery = `expectedAccountId=${boundUserId}&expectedAuthKind=guest`;
    const staleSavePath = `${boundSettingsPath}?${previousGuestQuery}`;
    const staleSaveBody = JSON.stringify({ customInstructions: "Stale edit" });
    const staleCsrf = cookieHeaders(browserGuestCookieName, browserGuest.guestToken)["x-csrf-token"];
    await expectCode(await routes.request(staleSavePath, {
      method: "POST", headers: { ...bothCookies, "x-csrf-token": staleCsrf }, body: staleSaveBody,
    }), 403, "SESSION_CSRF_TOKEN_INVALID");
    await expectCode(await routes.request(staleSavePath, {
      method: "POST", headers: bothCookies, body: staleSaveBody,
    }), 409, "ACCOUNT_SCOPE_CHANGED");
    assert.equal(await storedValue(boundWorkspaceId), boundInstructions);
    for (const [method, path] of [
      ["GET", boundSettingsPath], ["POST", boundSettingsPath], ["GET", "/chat"], ["POST", "/chat/new"],
    ]) {
      await expectCode(await routes.request(`${path}?${previousGuestQuery}`, { method, headers: bothCookies }),
        409, "ACCOUNT_SCOPE_CHANGED");
    }
    await expectInstructions(await routes.request(`${boundSettingsPath}?expectedAccountId=${boundUserId}&expectedAuthKind=registered`, {
      headers: bothCookies,
    }), boundInstructions);
    const boundClaim = await claimChatRun(boundUserId, boundWorkspaceId, queuedRun.runId);
    assert.ok(boundClaim);
    assert.equal(boundClaim.initiatingGuestSessionId, (await authenticateGuestSession(nativeGuest.guestToken)).sessionId);
    assert.equal(boundClaim.customInstructions, null);

    const chatPath = `/chat?workspaceId=${boundWorkspaceId}`;
    for (const path of [chatPath, `${chatPath}&limit=7`]) {
      await expectInstructions(await routes.request(path, { headers: accountHeaders }), boundInstructions);
      await expectInstructions(await routes.request(path, { headers: guestHeaders }), null);
    }

    const startSession = async (sessionId: string | undefined): Promise<Response> => routes.request("/chat/new", {
      method: "POST",
      headers: guestHeaders,
      body: JSON.stringify({ workspaceId: boundWorkspaceId, sessionId }),
    });
    const graceSessionId = randomUUID();
    for (const id of [graceSessionId, graceSessionId]) {
      const session = await expectInstructions(await startSession(id), null);
      assert.equal(session.sessionId, graceSessionId);
    }

    const signedInSessionId = randomUUID();
    const signedInRequestId = randomUUID();
    const signedInTurn = await expectInstructions(
      await sendTurn(accountHeaders, boundWorkspaceId, signedInSessionId, signedInRequestId),
      boundInstructions,
    );
    assert.equal(signedInTurn.accepted, true);
    const guestReplay = await expectInstructions(
      await sendTurn(guestHeaders, boundWorkspaceId, signedInSessionId, signedInRequestId),
      null,
    );
    assert.equal(guestReplay.accepted, true);
    assert.equal(guestReplay.deduplicated, true);

    const freshGuestSessionId = randomUUID();
    const freshGuestSession = await expectInstructions(await startSession(freshGuestSessionId), null);
    assert.equal(freshGuestSession.sessionId, freshGuestSessionId);
    const guestRequestId = randomUUID();
    const freshGuestTurn = await expectInstructions(
      await sendTurn(guestHeaders, boundWorkspaceId, freshGuestSessionId, guestRequestId),
      null,
    );
    assert.equal(freshGuestTurn.accepted, true);
    const signedInReplay = await expectInstructions(
      await sendTurn(accountHeaders, boundWorkspaceId, freshGuestSessionId, guestRequestId),
      boundInstructions,
    );
    assert.equal(signedInReplay.deduplicated, true);
    const guestActiveRun = freshGuestTurn.activeRun as ChatActiveRun | null;
    assert.ok(guestActiveRun);
    const guestClaim = await claimChatRun(boundUserId, boundWorkspaceId, guestActiveRun.runId);
    assert.ok(guestClaim);
    assert.equal(guestClaim.initiatingAuthIsSignedIn, false);
    assert.equal(guestClaim.customInstructions, null);
    const rollover = await expectInstructions(await startSession(undefined), null);
    assert.notEqual(rollover.sessionId, graceSessionId);
    assert.notEqual(rollover.sessionId, signedInSessionId);
    assert.notEqual(rollover.sessionId, freshGuestSessionId);

    const browserHeaders = cookieHeaders(browserGuestCookieName, browserGuest.guestToken);
    const browserInstructions = "Guest preferences for browser_product";
    const fundedSessionId = randomUUID();
    const fundedRequestId = randomUUID();
    const funded = await expectInstructions(await sendTurn(
      browserHeaders, browserGuest.workspaceId, fundedSessionId, fundedRequestId,
    ), browserInstructions);
    const fundedRun = funded.activeRun as ChatActiveRun | null;
    assert.ok(fundedRun);

    const otherBrowser = await createBrowserGuestSession(randomUUID(), null);
    userIds.push(otherBrowser.userId);
    workspaceIds.push(otherBrowser.workspaceId);
    const otherBrowserId = (await authenticateGuestSession(otherBrowser.guestToken)).sessionId;
    await owner.query("UPDATE auth.guest_sessions SET user_id = $1 WHERE session_id = $2", [browserGuest.userId, otherBrowserId]);
    const otherBrowserHeaders = cookieHeaders(browserGuestCookieName, otherBrowser.guestToken);
    const byokHeaders = { ...browserHeaders, "x-openai-api-key": "test-owned-key" };
    const byokSessionId = randomUUID();
    const byokRequestId = randomUUID();
    const byok = await expectInstructions(await sendTurn(byokHeaders, browserGuest.workspaceId, byokSessionId, byokRequestId),
      browserInstructions);
    const byokRun = byok.activeRun as ChatActiveRun | null;
    assert.ok(byokRun);

    await withProviderTestServer(async (_request, number, response) => {
      assert.equal(number, 1);
      await forgetBrowserGuestSession(browserGuest.guestToken);
      writeJsonResponse(response, 400, "chat-test-overflow", {
        error: { message: "input exceeds context window", code: "context_length_exceeded", type: "invalid_request_error" },
      });
    }, async (provider) => {
      setOpenAIBaseUrlForTests(provider.baseURL);
      const worker = { userId: browserGuest.userId, workspaceId: browserGuest.workspaceId };
      const execution = { lambdaRequestId: null, getRemainingTimeInMillis: () => 300_000 };
      await handleChatWorkerEvent({
        ...worker, runId: byokRun.runId, sessionId: byokSessionId, chatRequestId: byokRequestId,
        userOpenAIApiKey: byokHeaders["x-openai-api-key"],
      }, execution);
      assert.equal(provider.requests.length, 1);
      const sent = provider.requests[0];
      assert.equal(sent.authorization, "Bearer test-owned-key");
      const payload = sent.body as { input: Array<{ role?: string; content?: string }> };
      assert.equal(payload.input[1]?.role, "user");
      assert.ok(payload.input[1]?.content?.includes(browserInstructions));

      await expectCode(await routes.request(`/workspaces/${browserGuest.workspaceId}/chat-instructions`, {
        headers: browserHeaders,
      }), 401, "GUEST_AUTH_INVALID");
      const replay = await expectInstructions(await sendTurn(
        otherBrowserHeaders, browserGuest.workspaceId, fundedSessionId, fundedRequestId,
      ), browserInstructions);
      assert.equal(replay.deduplicated, true);
      await handleChatWorkerEvent({
        ...worker, runId: fundedRun.runId, sessionId: fundedSessionId, chatRequestId: fundedRequestId,
        browserGuestSessionId: otherBrowserId,
      }, execution);
      assert.equal(provider.requests.length, 1);
      const states = (await owner.query(
        "SELECT status FROM ai.chat_runs WHERE run_id = ANY($1::uuid[]) ORDER BY run_id",
        [[byokRun.runId, fundedRun.runId]],
      )).rows;
      assert.deepEqual(states, [{ status: "failed" }, { status: "failed" }]);
    });

    assert.equal((await save(ownerId, destination, "Make cards concise.")).status, 200);
    assert.equal(await storedValue(destination), "Make cards concise.");
    await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [destination]);
    assert.equal(await storedValue(destination), null);
  } finally {
    try {
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaceIds]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [userIds]);
    } finally {
      await owner.end();
    }
  }
});
