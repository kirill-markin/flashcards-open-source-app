import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { AuthTransport } from "../auth";
import { ensureCognitoUserProfile, type UserProfile } from "../auth/ensureUser";
import { transactionWithUserScope } from "../database";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  createGuestSession,
  prepareGuestUpgrade,
} from "../guestAuth";
import { createBrowserGuestSession } from "../guestAuth/browser/session";
import { createChatRoutes } from "../routes/chat";
import { resolveAccessibleChatWorkspaceId } from "../server/requestContext";
import { createWorkspaceInExecutor } from "../workspaces/create";
import type { ChatActiveRun } from "./contract";
import { claimChatRun } from "./runs/lifecycleService";
import { createRequestContext, createRoutesWithHttpErrorJson } from "./tests/routes/testSupport";

test("workspace chat instructions: access, validation, chat reads, run claims, starter use and cascade", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const accounts = new Map<string, Readonly<{ subject: string; profile: UserProfile }>>();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const routes = createRoutesWithHttpErrorJson();
  routes.route("/", createChatRoutes({
    allowedOrigins: [],
    resolveAccessibleChatWorkspaceIdFn: resolveAccessibleChatWorkspaceId,
    invokeChatWorkerFn: async () => undefined,
    createChatLiveStreamEnvelopeFn: async () => ({
      url: "https://example.test/chat/live",
      authorization: "Live test",
      expiresAt: Date.now() + 60_000,
    }),
    loadRequestContextFromRequestFn: async (request) => {
      const guestToken = request.headers.get("x-test-guest-token");
      if (guestToken !== null) {
        const guest = await authenticateGuestSession(guestToken);
        return {
          requestAuthInputs: {} as never,
          requestContext: {
            ...createRequestContext(),
            userId: guest.userId,
            subjectUserId: guest.userId,
            email: null,
            selectedWorkspaceId: null,
            transport: "guest",
            guestSessionId: guest.sessionId,
            guestPlatform: guest.platform,
            guestSessionPurpose: guest.purpose,
            guestCredentialSource: guest.purpose === "browser_product" ? "cookie" : "authorization",
          },
        };
      }
      const account = accounts.get(request.headers.get("x-test-user") ?? "");
      assert.ok(account);
      return {
        requestAuthInputs: {} as never,
        requestContext: {
          ...createRequestContext(),
          userId: account.profile.userId,
          subjectUserId: account.subject,
          clientAccountIdentity: account.profile.clientAccountIdentity,
          email: account.profile.email,
          selectedWorkspaceId: account.profile.selectedWorkspaceId,
          transport: (request.headers.get("x-test-transport") ?? "session") as AuthTransport,
        },
      };
    },
  }));
  const call = async (
    method: "GET" | "POST", userId: string, workspaceId: string, body?: string, transport?: AuthTransport,
  ): Promise<Readonly<{ status: number; json: Record<string, unknown> }>> => {
    const response = await routes.request(`/workspaces/${workspaceId}/chat-instructions`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-test-user": userId,
        ...(transport === undefined ? {} : { "x-test-transport": transport }),
      },
      ...(body === undefined ? {} : { body }),
    });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  const save = (userId: string, workspaceId: string, value: string | null) =>
    call("POST", userId, workspaceId, JSON.stringify({ customInstructions: value }));
  const create = async (accountId: string): Promise<string> => {
    const id = await transactionWithUserScope({ userId: accountId }, (executor) =>
      createWorkspaceInExecutor(executor, accountId, { name: "Personal", cause: "explicit" }));
    workspaceIds.push(id);
    return id;
  };
  const createAccount = async (): Promise<UserProfile> => {
    const subject = randomUUID();
    const profile = await ensureCognitoUserProfile(subject, `${subject}@example.test`);
    accounts.set(profile.userId, { subject, profile });
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
    assert.deepEqual(await call("GET", memberId, shared, undefined, "bearer"), {
      status: 200, json: { customInstructions: "Answer in German.", maxLength: 1500, canEdit: false },
    });
    assert.equal((await save(memberId, shared, "Mine")).json.code, "WORKSPACE_OWNER_REQUIRED");
    assert.equal((await save(memberId, shared, null)).json.code, "WORKSPACE_OWNER_REQUIRED");
    assert.deepEqual((await call("GET", ownerId, destination)).json, {
      customInstructions: null, maxLength: 1500, canEdit: true,
    });
    assert.equal((await call("GET", starterUserId, shared)).json.code, "WORKSPACE_NOT_FOUND");
    assert.equal((await call("GET", ownerId, "not-a-uuid")).json.code, "WORKSPACE_ID_INVALID");
    assert.equal((await call("GET", ownerId, shared, undefined, "api_key")).json.code, "AI_CHAT_V2_HUMAN_AUTH_REQUIRED");
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

    const chat = await routes.request(`/chat?workspaceId=${shared}`, { headers: { "x-test-user": memberId } });
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

    const createGuests = [
      () => createGuestSession("ios", null),
      () => createBrowserGuestSession(randomUUID(), null),
    ];
    for (const createGuest of createGuests) {
      const guest = await createGuest();
      userIds.push(guest.userId);
      workspaceIds.push(guest.workspaceId);
      const headers = { "content-type": "application/json", "x-test-guest-token": guest.guestToken };
      const settingsPath = `/workspaces/${guest.workspaceId}/chat-instructions`;
      const body = JSON.stringify({ customInstructions: "Guest preferences" });
      const read = await routes.request(settingsPath, { headers });
      const write = await routes.request(settingsPath, { method: "POST", headers, body });
      for (const response of [read, write]) {
        assert.equal(response.status, 403, guest.purpose);
        assert.equal(((await response.json()) as Record<string, unknown>).code, "ACCOUNT_SIGN_IN_REQUIRED");
      }
      assert.equal(await storedValue(guest.workspaceId), null);

      const guestChat = await routes.request(`/chat?workspaceId=${guest.workspaceId}`, { headers });
      assert.equal(guestChat.status, 200, guest.purpose);
      assert.equal(((await guestChat.json()) as Record<string, unknown>).customInstructions, null);
      const guestNewChat = await routes.request("/chat/new", {
        method: "POST",
        headers,
        body: JSON.stringify({ workspaceId: guest.workspaceId, sessionId: randomUUID() }),
      });
      assert.equal(guestNewChat.status, 200, guest.purpose);
    }

    const nativeGuest = await createGuestSession("ios", null);
    const { userId: boundUserId, workspaceId: boundWorkspaceId } = nativeGuest;
    userIds.push(boundUserId);
    workspaceIds.push(boundWorkspaceId);
    const boundSubject = randomUUID();
    const boundEmail = `${boundSubject}@example.test`;
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
    accounts.set(boundUserId, { subject: boundSubject, profile: await ensureCognitoUserProfile(boundSubject, null) });
    const boundInstructions = "Use concise examples.";
    assert.equal((await save(boundUserId, boundWorkspaceId, boundInstructions)).status, 200);

    const guestHeaders = { "content-type": "application/json", "x-test-guest-token": nativeGuest.guestToken };
    const accountHeaders = { "content-type": "application/json", "x-test-user": boundUserId };
    const expectInstructions = async (
      response: Response,
      expected: string | null,
    ): Promise<Record<string, unknown>> => {
      const json = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200, JSON.stringify(json));
      assert.equal(json.customInstructions, expected);
      return json;
    };
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
    const guestSessionId = randomUUID();
    for (const id of [guestSessionId, guestSessionId, undefined]) {
      const session = await expectInstructions(await startSession(id), null);
      assert.equal(session.sessionId, guestSessionId);
    }

    const sendTurn = async (
      headers: Readonly<Record<string, string>>,
      sessionId: string,
      clientRequestId: string,
    ): Promise<Response> => routes.request("/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: boundWorkspaceId,
        sessionId,
        clientRequestId,
        content: [{ type: "text", text: "Hello" }],
        timezone: "UTC",
      }),
    });
    const signedInSessionId = randomUUID();
    const signedInRequestId = randomUUID();
    const signedInTurn = await expectInstructions(
      await sendTurn(accountHeaders, signedInSessionId, signedInRequestId),
      boundInstructions,
    );
    assert.equal(signedInTurn.accepted, true);
    const guestReplay = await expectInstructions(
      await sendTurn(guestHeaders, signedInSessionId, signedInRequestId),
      null,
    );
    assert.equal(guestReplay.accepted, true);
    assert.equal(guestReplay.deduplicated, true);

    const freshGuestSessionId = randomUUID();
    const freshGuestSession = await expectInstructions(await startSession(freshGuestSessionId), null);
    assert.equal(freshGuestSession.sessionId, freshGuestSessionId);
    const guestRequestId = randomUUID();
    const freshGuestTurn = await expectInstructions(
      await sendTurn(guestHeaders, freshGuestSessionId, guestRequestId),
      null,
    );
    assert.equal(freshGuestTurn.accepted, true);
    const signedInReplay = await expectInstructions(
      await sendTurn(accountHeaders, freshGuestSessionId, guestRequestId),
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
    assert.notEqual(rollover.sessionId, guestSessionId);
    assert.notEqual(rollover.sessionId, signedInSessionId);
    assert.notEqual(rollover.sessionId, freshGuestSessionId);

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
