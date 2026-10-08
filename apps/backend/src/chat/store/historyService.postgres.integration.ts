import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type PostgresIntegrationFixture,
  withPostgresIntegrationFixture,
} from "../../testSupport/postgresIntegration";
import { archiveChatSession } from "../runs/historyService";
import {
  listChatSessionHistory,
  renameChatSession,
} from "./historyService";
import { getLatestChatSessionId } from "./sessionService";
import {
  ChatSessionArchiveActiveRunError,
  ChatSessionNotFoundError,
} from "./types";

type SessionFixture = Readonly<{
  userId: string;
  status: "idle" | "running";
  title: string | null;
  archived: boolean;
  createdAt: string;
  messages: ReadonlyArray<Readonly<{ role: "user" | "assistant"; text: string; createdAt: string }>>;
}>;

type SessionStateRow = Readonly<{ title: string | null; archived: boolean; updated_at: string }>;
type CountRow = Readonly<{ count: string }>;

async function insertSession(fixture: PostgresIntegrationFixture, session: SessionFixture): Promise<string> {
  const sessionId = randomUUID();
  // A running fixture carries a live heartbeat, so stale-run recovery leaves it running.
  await fixture.ownerPool.query(
    `INSERT INTO ai.chat_sessions (
       session_id, user_id, workspace_id, status, active_run_id, active_run_heartbeat_at,
       title, archived_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4,
       CASE WHEN $4 = 'running' THEN gen_random_uuid() ELSE NULL END,
       CASE WHEN $4 = 'running' THEN now() ELSE NULL END,
       $5, CASE WHEN $6::boolean THEN now() ELSE NULL END, $7, $7
     )`,
    [sessionId, session.userId, fixture.workspaceId, session.status, session.title, session.archived, session.createdAt],
  );
  for (const message of session.messages) {
    await fixture.ownerPool.query(
      `INSERT INTO ai.chat_items (session_id, item_kind, state, payload, created_at)
       VALUES ($1, 'message', 'completed', $2::jsonb, $3)`,
      [
        sessionId,
        JSON.stringify({
          role: message.role,
          content: [
            { type: "image", mediaType: "image/png", base64Data: "bWl0b2Nob25kcmlh" },
            { type: "text", text: message.text },
          ],
        }),
        message.createdAt,
      ],
    );
  }
  return sessionId;
}

async function readSessionState(fixture: PostgresIntegrationFixture, sessionId: string): Promise<SessionStateRow> {
  const result = await fixture.ownerPool.query<SessionStateRow>(
    `SELECT title, archived_at IS NOT NULL AS archived, updated_at::text AS updated_at
     FROM ai.chat_sessions WHERE session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Chat session fixture row is missing. sessionId=${sessionId}`);
  }
  return row;
}

test("chat history lists, searches, renames, and archives only the caller's own chats", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const otherUserId = `postgres-integration-${randomUUID()}`;
    await fixture.ownerPool.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [otherUserId]);
    try {
      const biologySessionId = await insertSession(fixture, {
        userId: fixture.userId, status: "idle", title: null, archived: false,
        createdAt: "2026-01-01T10:00:00.000001Z",
        messages: [
          { role: "user", text: "How do  mitochondria\nmake ATP?", createdAt: "2026-01-01T10:00:01.000001Z" },
          { role: "assistant", text: "Through oxidative phosphorylation.", createdAt: "2026-01-01T10:00:02.000001Z" },
        ],
      });
      const spanishSessionId = await insertSession(fixture, {
        userId: fixture.userId, status: "running", title: "Spanish verbs", archived: false,
        createdAt: "2026-01-02T10:00:00.000001Z",
        messages: [{ role: "user", text: "Conjugate ser", createdAt: "2026-01-02T10:00:01.000001Z" }],
      });
      const emptySessionId = await insertSession(fixture, {
        userId: fixture.userId, status: "idle", title: null, archived: false,
        createdAt: "2026-01-03T10:00:00.000001Z", messages: [],
      });
      const archivedSessionId = await insertSession(fixture, {
        userId: fixture.userId, status: "idle", title: null, archived: true,
        createdAt: "2026-01-04T10:00:00.000001Z",
        messages: [{ role: "user", text: "Archived mitochondria", createdAt: "2026-01-04T10:00:01.000001Z" }],
      });
      const foreignSessionId = await insertSession(fixture, {
        userId: otherUserId, status: "idle", title: null, archived: false,
        createdAt: "2026-01-05T10:00:00.000001Z",
        messages: [{ role: "user", text: "Foreign mitochondria", createdAt: "2026-01-05T10:00:01.000001Z" }],
      });

      const firstPage = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 1, null, null);
      assert.deepEqual(firstPage.sessions.map((session) => session.sessionId), [spanishSessionId]);
      assert.notEqual(firstPage.nextCursor, null);
      const secondPage = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 1, firstPage.nextCursor, null);
      assert.equal(secondPage.nextCursor, null);
      assert.deepEqual(secondPage.sessions, [{
        sessionId: biologySessionId,
        title: "How do mitochondria make ATP?",
        hasCustomTitle: false,
        preview: "Through oxidative phosphorylation.",
        messageCount: 2,
        createdAt: Date.parse("2026-01-01T10:00:00.000Z"),
        lastActivityAt: Date.parse("2026-01-01T10:00:02.000Z"),
      }]);

      const assistantTextMatch = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 20, null, "OXIDATIVE");
      assert.deepEqual(assistantTextMatch.sessions.map((session) => session.sessionId), [biologySessionId]);
      const titleMatch = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 20, null, "spanish");
      assert.deepEqual(titleMatch.sessions.map((session) => session.sessionId), [spanishSessionId]);
      const attachmentOnlyMatch = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 20, null, "bWl0b2");
      assert.deepEqual(attachmentOnlyMatch.sessions, []);
      const wildcardMatch = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 20, null, "%");
      assert.deepEqual(wildcardMatch.sessions, []);

      assert.equal(await getLatestChatSessionId(fixture.userId, fixture.workspaceId), emptySessionId);

      const biologyBeforeRename = await readSessionState(fixture, biologySessionId);
      const renamed = await renameChatSession(fixture.userId, fixture.workspaceId, biologySessionId, "Cell energy");
      assert.equal(renamed.title, "Cell energy");
      assert.equal(renamed.hasCustomTitle, true);
      assert.equal((await readSessionState(fixture, biologySessionId)).updated_at, biologyBeforeRename.updated_at);

      const unknownSessionId = randomUUID();
      for (const unreachableSessionId of [foreignSessionId, archivedSessionId, unknownSessionId]) {
        await assert.rejects(
          renameChatSession(fixture.userId, fixture.workspaceId, unreachableSessionId, "Taken"),
          ChatSessionNotFoundError,
        );
        await assert.rejects(
          archiveChatSession(fixture.userId, fixture.workspaceId, unreachableSessionId),
          ChatSessionNotFoundError,
        );
      }
      assert.equal((await readSessionState(fixture, foreignSessionId)).title, null);
      assert.equal((await readSessionState(fixture, foreignSessionId)).archived, false);
      const unknownRows = await fixture.ownerPool.query<CountRow>(
        "SELECT count(*)::text AS count FROM ai.chat_sessions WHERE session_id = $1",
        [unknownSessionId],
      );
      assert.equal(unknownRows.rows[0]?.count, "0");

      await assert.rejects(
        archiveChatSession(fixture.userId, fixture.workspaceId, spanishSessionId),
        ChatSessionArchiveActiveRunError,
      );

      const archived = await archiveChatSession(fixture.userId, fixture.workspaceId, biologySessionId);
      assert.equal(archived.sessionId, biologySessionId);
      const biologyAfterArchive = await readSessionState(fixture, biologySessionId);
      assert.equal(biologyAfterArchive.archived, true);
      assert.equal(biologyAfterArchive.updated_at, biologyBeforeRename.updated_at);
      const afterArchive = await listChatSessionHistory(fixture.userId, fixture.workspaceId, 20, null, null);
      assert.deepEqual(afterArchive.sessions.map((session) => session.sessionId), [spanishSessionId]);
    } finally {
      await fixture.ownerPool.query("DELETE FROM org.user_settings WHERE user_id = $1", [otherUserId]);
    }
  });
});
