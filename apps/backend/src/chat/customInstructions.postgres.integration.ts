import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyWorkspaceDatabaseScopeInExecutor, transactionWithUserScope } from "../database";
import { createChatRoutes } from "../routes/chat";
import type { AuthTransport } from "../auth";
import { createWorkspaceInExecutor } from "../workspaces/create";
import { copyWorkspaceChatInstructionsInExecutor } from "./customInstructions";
import { claimChatRun } from "./runs/lifecycleService";
import { createRequestContext, createRoutesWithHttpErrorJson } from "./tests/routes/testSupport";

test("workspace chat instructions: access, validation, chat reads, run claims, starter use, guest copy and cascade", async () => {
  const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (ownerUrl === undefined) throw new Error("TEST_DATABASE_ADMIN_URL is required");
  const owner = new pg.Client({ connectionString: ownerUrl });
  const [ownerId, memberId, starterUserId] = [randomUUID(), randomUUID(), randomUUID()];
  const workspaceIds: string[] = [];
  const routes = createRoutesWithHttpErrorJson();
  routes.route("/", createChatRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async (request) => {
      const userId = request.headers.get("x-test-user") ?? "";
      const transport = (request.headers.get("x-test-transport") ?? "session") as AuthTransport;
      return {
        requestAuthInputs: {} as never,
        requestContext: { ...createRequestContext(), userId, subjectUserId: userId, selectedWorkspaceId: null, transport },
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
  const create = async (accountId: string, cause: "automatic_starter" | "explicit"): Promise<string> => {
    const id = await transactionWithUserScope({ userId: accountId }, (executor) =>
      createWorkspaceInExecutor(executor, accountId, { name: "Personal", cause }));
    workspaceIds.push(id);
    return id;
  };
  const isUnusedStarter = async (workspaceId: string): Promise<boolean> =>
    (await owner.query("SELECT org.workspace_is_unused_starter($1) AS unused", [workspaceId])).rows[0].unused;
  const copyAs = async (userId: string, workspaceId: string, value: string): Promise<void> =>
    transactionWithUserScope({ userId }, async (executor) => {
      await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
      await copyWorkspaceChatInstructionsInExecutor(executor, value, workspaceId);
    });
  const storedValue = async (workspaceId: string): Promise<string | null> =>
    (await owner.query("SELECT custom_instructions FROM ai.workspace_chat_instructions WHERE workspace_id = $1",
      [workspaceId])).rows[0]?.custom_instructions ?? null;

  try {
    await owner.connect();
    await owner.query("INSERT INTO org.user_settings(user_id) VALUES ($1),($2),($3)", [ownerId, memberId, starterUserId]);
    const shared = await create(ownerId, "explicit");
    const destination = await create(ownerId, "explicit");
    const starter = await create(starterUserId, "automatic_starter");
    await owner.query("INSERT INTO org.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [shared, memberId]);

    assert.deepEqual(await call("GET", ownerId, shared), { status: 200, json: { customInstructions: null, maxLength: 1500 } });
    assert.deepEqual(await save(ownerId, shared, "  Answer in German.\n"), {
      status: 200, json: { customInstructions: "Answer in German.", maxLength: 1500 },
    });
    assert.deepEqual((await call("GET", memberId, shared)).json.customInstructions, "Answer in German.");
    assert.equal((await save(memberId, shared, "Mine")).json.code, "WORKSPACE_OWNER_REQUIRED");
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
      `INSERT INTO ai.chat_runs(run_id,session_id,assistant_item_id,status,request_id,model_id,reasoning_effort,timezone,turn_input)
       VALUES ($1,$2,$3,'queued',$4,'gpt-5.6-terra','xhigh','UTC','[]'::jsonb)`,
      [runId, sessionId, assistantItemId, randomUUID()],
    );
    assert.equal((await claimChatRun(ownerId, shared, runId))?.customInstructions, "Answer in German.");

    assert.equal(await isUnusedStarter(starter), true);
    assert.equal((await save(starterUserId, starter, "Brief answers")).status, 200);
    assert.equal(await isUnusedStarter(starter), false);
    assert.deepEqual((await save(starterUserId, starter, "   ")).json, { customInstructions: null, maxLength: 1500 });
    assert.equal(await storedValue(starter), null);
    assert.equal(await isUnusedStarter(starter), true);

    await copyAs(ownerId, destination, "From the guest");
    await copyAs(ownerId, destination, "A later guest");
    assert.equal(await storedValue(destination), "From the guest");
    await copyAs(ownerId, shared, "From the guest");
    assert.equal(await storedValue(shared), "Answer in German.");
    await owner.query("DELETE FROM ai.workspace_chat_instructions WHERE workspace_id = $1", [shared]);
    await copyAs(memberId, shared, "From the guest");
    assert.equal(await storedValue(shared), null);

    await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [destination]);
    assert.equal(await storedValue(destination), null);
  } finally {
    try {
      await owner.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaceIds]);
      await owner.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [[ownerId, memberId, starterUserId]]);
    } finally {
      await owner.end();
    }
  }
});
