import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import pg from "pg";
import { ensureCognitoUserProfile } from "../auth/ensureUser";
import { resetAuthConfigForTests } from "../auth/config";
import { transactionWithUserScope } from "../database";
import {
  authenticateGuestSession,
  completeGuestUpgrade,
  createGuestSession,
  deleteGuestSession,
  linkGuestAnalyticsIdentity,
  prepareGuestUpgrade,
} from "../guestAuth";
import { claimChatRun, persistClaimedChatRunCancelled, prepareChatRun } from "../chat/runs";
import { createAiConsentRoutes } from "../routes/aiConsent";
import { createChatRoutes } from "../routes/chat";
import { createChatTranscriptionsRoutes } from "../routes/chatTranscriptions";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import { assertAiConsentReceiptActive, recordAiConsent } from ".";
import { currentAiDisclosureVersion, parseAiConsentInput, type AiConsentReceipt } from "./input";

function requireOwnerDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_ADMIN_URL;
  if (value === undefined || value.trim() === "") throw new Error("TEST_DATABASE_ADMIN_URL is required for AI consent integration.");
  return value;
}

function isConsentRefusal(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 403 && error.code === "AI_CONSENT_REQUIRED";
}

function createIntegrationApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error, context) => {
    if (error instanceof HttpError) return context.json({ code: error.code }, error.statusCode as 400 | 403 | 409 | 410);
    throw error;
  });
  app.route("/v1", createAiConsentRoutes({ allowedOrigins: [] }));
  app.route("/v1", createChatRoutes({ allowedOrigins: [] }));
  app.route("/v1", createChatTranscriptionsRoutes({ allowedOrigins: [] }));
  return app;
}

test("real consent HTTP and PostgreSQL lifecycle preserves decisions through replay, withdrawal, guest upgrade, and deletion", async () => {
  const previousAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = "cognito";
  resetAuthConfigForTests();
  const ownerPool = new pg.Pool({ connectionString: requireOwnerDatabaseUrl() });
  const userIds: Array<string> = [];
  const workspaceIds: Array<string> = [];
  try {
    const guest = await createGuestSession("ios", null);
    const other = await createGuestSession("ios", null);
    const guestSessionId = (await authenticateGuestSession(guest.guestToken)).sessionId;
    const otherSessionId = (await authenticateGuestSession(other.guestToken)).sessionId;
    userIds.push(guest.userId, other.userId);
    workspaceIds.push(guest.workspaceId, other.workspaceId);
    await ownerPool.query(
      "UPDATE auth.guest_sessions SET analytics_consent = 'declined', product_analytics_enabled = false WHERE user_id = $1",
      [guest.userId],
    );
    const app = createIntegrationApp();
    const input = parseAiConsentInput({
      eventId: randomUUID(), installationId: randomUUID(), action: "grant", decisionSequence: 1,
      occurredAt: "2026-10-12T09:00:00.000Z", disclosureVersion: currentAiDisclosureVersion,
      locale: "fr", disclosureText: "Nibomo transmet le contenu demandé à OpenAI pour les fonctions IA.",
      appVersion: "1.33.0", appBuild: "133", platform: "ios",
    });
    const submit = async (token: string, body: object): Promise<Response> => app.request("/v1/ai/consent", {
      method: "POST", headers: { authorization: `Guest ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const granted = await submit(guest.guestToken, { ...input, userId: other.userId });
    assert.equal(granted.status, 200);
    const receipt = await granted.json() as AiConsentReceipt;
    assert.equal(receipt.eventId, input.eventId);
    assert.equal(receipt.occurredAt, input.occurredAt);
    assert.ok(Number.isFinite(Date.parse(receipt.receivedAt)));
    const evidence = await ownerPool.query<Readonly<{ actor_user_id: string; disclosure_text: string; locale: string }>>(
      "SELECT actor_user_id, disclosure_text, locale FROM ai.consent_events WHERE event_id = $1", [input.eventId],
    );
    assert.deepEqual(evidence.rows[0], { actor_user_id: guest.userId, disclosure_text: input.disclosureText, locale: input.locale });
    const retried = await submit(guest.guestToken, input);
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), receipt);
    const changedReplay = await submit(guest.guestToken, { ...input, action: "withdraw" });
    assert.equal(changedReplay.status, 409);
    assert.equal((await submit(other.guestToken, input)).status, 409);
    await assert.rejects(assertAiConsentReceiptActive(other.userId, input.eventId), isConsentRefusal);
    await assertAiConsentReceiptActive(guest.userId, input.eventId);
    await assertAiConsentReceiptActive(guest.userId, null);

    const sessionId = randomUUID();
    const prepared = await prepareChatRun(
      guest.userId, guest.workspaceId, sessionId, [{ type: "text", text: "Create a study card." }],
      randomUUID(), "UTC", "fr", false, "ios", "ios", "phone",
      () => assertAiConsentReceiptActive(guest.userId, input.eventId), input.eventId,
    );
    const claimed = await claimChatRun(guest.userId, guest.workspaceId, prepared.runId);
    assert.equal(claimed?.aiConsentId, input.eventId);
    if (claimed === null) throw new Error("Prepared run was not claimed.");

    const withdrawnInput = { ...input, eventId: randomUUID(), action: "withdraw" as const,
      decisionSequence: 3, occurredAt: "2026-10-12T08:00:00.000Z" };
    const withdrawal = await recordAiConsent(guest.userId, withdrawnInput, guestSessionId);
    assert.deepEqual(await recordAiConsent(guest.userId, withdrawnInput, guestSessionId), withdrawal);
    await assert.rejects(assertAiConsentReceiptActive(guest.userId, input.eventId), isConsentRefusal);
    await assert.rejects(assertAiConsentReceiptActive(guest.userId, withdrawal.eventId), isConsentRefusal);
    const delayedGrant = await recordAiConsent(guest.userId, { ...input, eventId: randomUUID(), decisionSequence: 2 }, guestSessionId);
    await assert.rejects(assertAiConsentReceiptActive(guest.userId, delayedGrant.eventId), isConsentRefusal);
    for (const path of ["/v1/chat", "/v1/chat/transcriptions"]) {
      const refused = await app.request(path, { method: "POST", headers: {
        authorization: `Guest ${guest.guestToken}`, "X-AI-Consent-Id": input.eventId,
      } });
      assert.equal(refused.status, 403);
      assert.deepEqual(await refused.json(), { code: "AI_CONSENT_REQUIRED" });
    }
    const history = await app.request(`/v1/chat/sessions?workspaceId=${guest.workspaceId}`, {
      headers: { authorization: `Guest ${guest.guestToken}`, "X-AI-Consent-Id": input.eventId },
    });
    assert.equal(history.status, 200);
    const stopped = await app.request("/v1/chat/stop", { method: "POST", headers: {
      authorization: `Guest ${guest.guestToken}`, "content-type": "application/json", "X-AI-Consent-Id": input.eventId,
    }, body: JSON.stringify({ workspaceId: guest.workspaceId, sessionId, runId: prepared.runId }) });
    assert.equal(stopped.status, 200);
    await persistClaimedChatRunCancelled(guest.userId, guest.workspaceId, {
      runId: claimed.runId, sessionId, assistantItemId: claimed.assistantItemId, assistantContent: [],
    }, claimed.claimToken);
    const snapshot = await app.request(`/v1/chat?workspaceId=${guest.workspaceId}&sessionId=${sessionId}`, {
      headers: { authorization: `Guest ${guest.guestToken}`, "X-AI-Consent-Id": input.eventId },
    });
    assert.equal(snapshot.status, 200);
    const regrant = await recordAiConsent(guest.userId, { ...input, eventId: randomUUID(), decisionSequence: 4 }, guestSessionId);
    await assertAiConsentReceiptActive(guest.userId, regrant.eventId);
    await assert.rejects(assertAiConsentReceiptActive(guest.userId, input.eventId), isConsentRefusal);
    await assert.rejects(transactionWithUserScope({ userId: guest.userId }, (executor) => executor.query(
      "UPDATE ai.consent_events SET action = 'grant' WHERE event_id = $1", [withdrawal.eventId],
    )), (error: unknown) => error instanceof Error && "code" in error && error.code === "42501");

    const subject = randomUUID();
    const target = await ensureCognitoUserProfile(subject, null);
    userIds.push(target.userId);
    assert.notEqual(target.selectedWorkspaceId, null);
    if (target.selectedWorkspaceId === null) throw new Error("Target account has no workspace.");
    workspaceIds.push(target.selectedWorkspaceId);
    const destinationGrant = await recordAiConsent(target.userId, { ...input,
      eventId: randomUUID(), decisionSequence: 4 }, null);
    await assertAiConsentReceiptActive(target.userId, destinationGrant.eventId);
    const retired = await createGuestSession("ios", null);
    userIds.push(retired.userId);
    workspaceIds.push(retired.workspaceId);
    const retiredSessionId = (await authenticateGuestSession(retired.guestToken)).sessionId;
    await linkGuestAnalyticsIdentity(retired.guestToken, subject);
    await assert.rejects(recordAiConsent(retired.userId, { ...input, eventId: randomUUID() }, retiredSessionId),
      (error: unknown) => error instanceof HttpError && error.code === "AI_CONSENT_IDENTITY_DELETED");
    await assert.rejects(linkGuestAnalyticsIdentity(guest.guestToken, subject),
      (error: unknown) => error instanceof HttpError && error.code === "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED");
    assert.equal((await prepareGuestUpgrade(guest.guestToken, subject, null)).mode, "merge_required");
    await completeGuestUpgrade(guest.guestToken, subject, { type: "existing", workspaceId: target.selectedWorkspaceId }, {
      guestWorkspaceSyncedAndOutboxDrained: true, requiresGuestWorkspaceSyncedAndOutboxDrained: true,
      supportsDroppedEntities: true,
    });
    assert.deepEqual(await recordAiConsent(target.userId, input, null), receipt);
    await assert.rejects(assertAiConsentReceiptActive(target.userId, regrant.eventId), isConsentRefusal);
    await assert.rejects(assertAiConsentReceiptActive(target.userId, destinationGrant.eventId), isConsentRefusal);
    await assert.rejects(assertAiConsentReceiptActive(other.userId, regrant.eventId), isConsentRefusal);
    const afterMergeGrant = await recordAiConsent(target.userId, { ...input,
      eventId: randomUUID(), decisionSequence: 5 }, null);
    await assertAiConsentReceiptActive(target.userId, afterMergeGrant.eventId);
    await assert.rejects(assertAiConsentReceiptActive(target.userId, regrant.eventId), isConsentRefusal);
    await assert.rejects(assertAiConsentReceiptActive(target.userId, destinationGrant.eventId), isConsentRefusal);
    const afterUpgrade = await recordAiConsent(target.userId, { ...input, eventId: randomUUID(),
      action: "withdraw", decisionSequence: 6 }, null);
    await assert.rejects(assertAiConsentReceiptActive(target.userId, afterMergeGrant.eventId), isConsentRefusal);
    assert.deepEqual(await recordAiConsent(target.userId, withdrawnInput, null), withdrawal);

    await transactionWithUserScope({ userId: target.userId }, (executor) => executor.query(
      "DELETE FROM org.user_settings WHERE user_id = $1", [target.userId],
    ));
    const remaining = await ownerPool.query<Readonly<{ count: number }>>(
      "SELECT count(*)::int AS count FROM ai.consent_events WHERE event_id = ANY($1::uuid[])",
      [[input.eventId, withdrawal.eventId, delayedGrant.eventId, regrant.eventId,
        destinationGrant.eventId, afterMergeGrant.eventId, afterUpgrade.eventId]],
    );
    assert.equal(remaining.rows[0]?.count, 0);
    const identities = await ownerPool.query<Readonly<{ count: number }>>(
      "SELECT count(*)::int AS count FROM ai.consent_identities WHERE user_id = $1 OR actor_user_id = $2",
      [target.userId, guest.userId],
    );
    assert.equal(identities.rows[0]?.count, 0);
    const otherReceipt = await recordAiConsent(other.userId, { ...input, eventId: randomUUID() }, otherSessionId);
    await deleteGuestSession(other.guestToken);
    await assert.rejects(assertAiConsentReceiptActive(other.userId, otherReceipt.eventId), isConsentRefusal);
  } finally {
    try {
      await ownerPool.query("DELETE FROM org.workspaces WHERE workspace_id = ANY($1::uuid[])", [workspaceIds]);
      await ownerPool.query("DELETE FROM org.user_settings WHERE user_id = ANY($1::text[])", [userIds]);
      await ownerPool.query("DELETE FROM auth.guest_upgrade_history WHERE source_guest_user_id = ANY($1::text[])", [userIds]);
    } finally {
      await ownerPool.end();
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
      resetAuthConfigForTests();
    }
  }
});
