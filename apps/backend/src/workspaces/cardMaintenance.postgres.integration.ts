import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { resetAuthConfigForTests } from "../auth/config";
import { createCard, getCard, submitReview, updateCard } from "../cards";
import { createDeck, getDeck, updateDeck } from "../decks";
import { createApp } from "../server/app";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";
import { createWorkspaceForUser } from "./create";
import {
  buildCardMaintenancePreviewFingerprint,
  parseCardMaintenancePreviewFingerprint,
  type CardMaintenanceInput,
  type CardMaintenancePreview,
} from "./cardMaintenance";

async function databaseTimeMs(owner: pg.Pool): Promise<number> {
  const result = await owner.query<Readonly<{ time_ms: number }>>(
    "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS time_ms",
  );
  const row = result.rows[0];
  assert.ok(row);
  return row.time_ms;
}

async function waitForBlockedRequest(owner: pg.Pool, blockerPid: number): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await owner.query<Readonly<{ pid: number }>>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [blockerPid],
    );
    const waiter = result.rows[0];
    if (waiter !== undefined) {
      return waiter.pid;
    }
    await delay(10);
  }
  assert.fail(`No request was blocked by PostgreSQL session ${blockerPid}`);
}

test("card maintenance confirms the exact persisted scope and syncs only the selected mutations", async (t) => {
  assert.ok(process.env.TEST_DATABASE_ADMIN_URL, "Run with npm run test:postgres-integration");
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  const previousAuthMode = process.env.AUTH_MODE;
  const previousInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  const userId = "local";
  let workspaceId: string | null = null;

  try {
    const workspace = await createWorkspaceForUser(userId, "Card maintenance integration");
    workspaceId = workspace.workspaceId;
    const app = createApp("/v1");
    const origin = "http://localhost:3000";
    const basePath = "/v1/workspaces/" + workspaceId + "/card-maintenance";
    const post = (action: "preview" | "execute" | "reconcile", input: object): Promise<Response> => Promise.resolve(
      app.request(basePath + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(input),
      }),
    );
    const preview = async (input: CardMaintenanceInput): Promise<CardMaintenancePreview> => {
      const response = await post("preview", input);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      return await response.json() as CardMaintenancePreview;
    };
    const execute = (input: CardMaintenanceInput, confirmation: CardMaintenancePreview): Promise<Response> =>
      post("execute", {
        ...input,
        confirmationText: confirmation.confirmationText,
        previewFingerprint: confirmation.previewFingerprint,
      });
    const reconcile = (previewFingerprint: string): Promise<Response> => post("reconcile", { previewFingerprint });
    const readSettlement = async (response: Response): Promise<boolean> => {
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      return (await response.json() as Readonly<{ isSettled: boolean }>).isSettled;
    };
    const readError = async (response: Response, status: number): Promise<string> => {
      assert.equal(response.status, status, await response.clone().text());
      return (await response.json() as Readonly<{ code: string }>).code;
    };
    const replicaId = buildSystemWorkspaceReplicaId(workspaceId, "workspace_seed", "workspace-seed");
    const metadata = () => ({
      clientUpdatedAt: new Date().toISOString(),
      lastModifiedByReplicaId: replicaId,
      lastOperationId: randomUUID(),
    });
    const makeCard = (frontText: string, tags: ReadonlyArray<string>) =>
      createCard(userId, workspace.workspaceId, { frontText, backText: "Answer", tags }, metadata());
    const reviewCard = async (cardId: string): Promise<void> => {
      const reviewMetadata = metadata();
      await submitReview(userId, workspace.workspaceId, replicaId, {
        cardId,
        rating: 2,
        reviewedAtClient: reviewMetadata.clientUpdatedAt,
      }, reviewMetadata);
    };
    const cardA = await makeCard("First question?", ["Topic"]);
    const cardB = await makeCard("Second question?", ["Keep"]);
    const newCard = await makeCard("New question?", [" TOPIC "]);
    await reviewCard(cardA.cardId);
    await reviewCard(cardB.cardId);
    const deck = await createDeck(userId, workspaceId, {
      name: "Topic deck",
      filterDefinition: { version: 2, tags: ["Topic", "Unmatched"] },
    }, metadata());
    const unfilteredDeck = await createDeck(userId, workspaceId, {
      name: "Unfiltered",
      filterDefinition: { version: 2, tags: [] },
    }, metadata());

    const deckReset: CardMaintenanceInput = { kind: "resetDeck", target: deck.deckId };
    const beforeSwap = await preview(deckReset);
    assert.equal(beforeSwap.affectedCardsCount, 1);
    assert.equal(beforeSwap.includesAllCards, false);
    const allCards = await preview({ kind: "resetDeck", target: unfilteredDeck.deckId });
    assert.equal(allCards.affectedCardsCount, 2);
    assert.equal(allCards.includesAllCards, true);
    await updateCard(userId, workspaceId, cardA.cardId, {
      frontText: cardA.frontText, backText: cardA.backText, tags: [],
    }, metadata());
    await updateCard(userId, workspaceId, cardB.cardId, {
      frontText: cardB.frontText, backText: cardB.backText, tags: ["TOPIC", " Topic ", "Keep"],
    }, metadata());

    const afterSwap = await preview(deckReset);
    assert.equal(afterSwap.affectedCardsCount, beforeSwap.affectedCardsCount);
    assert.equal(await readError(await execute(deckReset, beforeSwap), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
    const filterDefinition = { version: 2 as const, tags: ["Topic"] };
    await updateDeck(userId, workspaceId, deck.deckId, { name: deck.name, filterDefinition }, metadata());
    assert.equal(await readError(await execute(deckReset, afterSwap), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");

    const tagReset = await preview({ kind: "resetTag", target: "Topic" });
    assert.equal(tagReset.affectedCardsCount, 1);
    const current = await preview(deckReset);
    const wrongPhrase = { ...current, confirmationText: current.confirmationText + " " };
    assert.equal(await readError(await execute(deckReset, wrongPhrase), 400), "CARD_MAINTENANCE_CONFIRMATION_INVALID");
    const reset = await execute(deckReset, current);
    assert.equal(reset.status, 200, await reset.clone().text());
    assert.deepEqual(await reset.json(), { affectedCardsCount: 1 });
    assert.equal((await getCard(userId, workspaceId, cardA.cardId)).reps, 1);
    assert.equal((await getCard(userId, workspaceId, cardB.cardId)).reps, 0);
    assert.equal(await readError(await execute(deckReset, current), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");

    const remove: CardMaintenanceInput = { kind: "removeTag", target: "Topic" };
    const removal = await preview(remove);
    assert.equal(removal.affectedCardsCount, 2);
    assert.equal(removal.affectedDecksCount, 1);
    const removed = await execute(remove, removal);
    assert.equal(removed.status, 200, await removed.clone().text());
    assert.deepEqual(await removed.json(), { affectedCardsCount: 2 });
    assert.deepEqual((await getCard(userId, workspaceId, cardB.cardId)).tags, ["Keep"]);
    assert.deepEqual((await getCard(userId, workspaceId, newCard.cardId)).tags, []);
    assert.deepEqual((await getDeck(userId, workspaceId, deck.deckId)).filterDefinition, filterDefinition);

    const cardReset: CardMaintenanceInput = { kind: "resetCard", target: cardA.cardId };
    const cardPreview = await preview(cardReset);
    assert.equal(cardPreview.targetName, cardA.frontText);
    assert.equal(cardPreview.affectedCardsCount, 1);
    const resetCard = await execute(cardReset, cardPreview);
    assert.equal(resetCard.status, 200, await resetCard.clone().text());
    assert.deepEqual(await resetCard.json(), { affectedCardsCount: 1 });
    assert.equal((await getCard(userId, workspaceId, cardA.cardId)).reps, 0);

    const history = await owner.query(
      "SELECT count(*)::int AS count FROM content.review_events WHERE workspace_id = $1",
      [workspaceId],
    );
    assert.equal(history.rows[0].count, 2);
    const changes = await owner.query(
      [
        "SELECT entity_id FROM sync.hot_changes JOIN sync.workspace_replicas USING (workspace_id, replica_id)",
        "WHERE workspace_id = $1 AND entity_type = 'card' AND actor_kind = 'workspace_reset' ORDER BY change_id",
      ].join(" "),
      [workspaceId],
    );
    assert.deepEqual(changes.rows.map((row) => row.entity_id), [
      cardB.cardId, ...[cardB.cardId, newCard.cardId].sort(), cardA.cardId,
    ]);

    await t.test("tag maintenance matches the app's Unicode keys for cards and deck rules", async () => {
      const plain = await makeCard("Plain I?", [" ISTANBUL ", "İSTANBUL", "Keep"]);
      const dotted = await makeCard("Dotted I?", ["İSTANBUL"]);
      await reviewCard(plain.cardId);
      await reviewCard(dotted.cardId);
      const plainDeck = await createDeck(userId, workspace.workspaceId, {
        name: "Plain I deck", filterDefinition: { version: 2, tags: ["istanbul", "Unmatched"] },
      }, metadata());
      const dottedDeck = await createDeck(userId, workspace.workspaceId, {
        name: "Dotted I deck", filterDefinition: { version: 2, tags: ["İstanbul"] },
      }, metadata());

      const resetPlainDeck: CardMaintenanceInput = { kind: "resetDeck", target: plainDeck.deckId };
      const plainPreview = await preview(resetPlainDeck);
      assert.equal(plainPreview.affectedCardsCount, 1);
      const resetPlain = await execute(resetPlainDeck, plainPreview);
      assert.equal(resetPlain.status, 200, await resetPlain.clone().text());
      assert.equal((await getCard(userId, workspace.workspaceId, plain.cardId)).reps, 0);
      assert.equal((await getCard(userId, workspace.workspaceId, dotted.cardId)).reps, 1);
      assert.equal((await preview({ kind: "resetTag", target: "istanbul" })).affectedCardsCount, 0);

      const resetDotted: CardMaintenanceInput = { kind: "resetTag", target: "İstanbul" };
      assert.equal((await preview({ kind: "resetDeck", target: dottedDeck.deckId })).affectedCardsCount, 1);
      const dottedPreview = await preview(resetDotted);
      assert.equal(dottedPreview.affectedCardsCount, 1);
      const dottedReset = await execute(resetDotted, dottedPreview);
      assert.equal(dottedReset.status, 200, await dottedReset.clone().text());
      assert.equal((await getCard(userId, workspace.workspaceId, dotted.cardId)).reps, 0);

      const removePlain: CardMaintenanceInput = { kind: "removeTag", target: "istanbul" };
      const removePlainPreview = await preview(removePlain);
      assert.equal(removePlainPreview.affectedCardsCount, 1);
      assert.equal(removePlainPreview.affectedDecksCount, 1);
      const plainRemoval = await execute(removePlain, removePlainPreview);
      assert.equal(plainRemoval.status, 200, await plainRemoval.clone().text());
      assert.deepEqual((await getCard(userId, workspace.workspaceId, plain.cardId)).tags, ["İSTANBUL", "Keep"]);
      assert.deepEqual((await getCard(userId, workspace.workspaceId, dotted.cardId)).tags, ["İSTANBUL"]);
      const removeDotted = await preview({ kind: "removeTag", target: "İstanbul" });
      assert.equal(removeDotted.affectedCardsCount, 2);
      assert.equal(removeDotted.affectedDecksCount, 1);
    });

    await t.test("a queued execute expires before admission and reconcile waits for its access lock", async () => {
      const card = await makeCard("Expiring confirmation?", []);
      await reviewCard(card.cardId);
      const input: CardMaintenanceInput = { kind: "resetCard", target: card.cardId };
      const previewStartedAt = await databaseTimeMs(owner);
      const confirmation = await preview(input);
      const { expiresAtMs } = parseCardMaintenancePreviewFingerprint(confirmation.previewFingerprint);
      assert.equal(confirmation.affectedCardsCount, 1);
      assert.ok(expiresAtMs >= previewStartedAt + 120_000);
      assert.ok(expiresAtMs <= await databaseTimeMs(owner) + 120_000);
      assert.equal(await readSettlement(await reconcile(confirmation.previewFingerprint)), false);

      const digest = confirmation.previewFingerprint.slice(confirmation.previewFingerprint.indexOf(".") + 1);
      const tampered = { ...confirmation, previewFingerprint: `${expiresAtMs + 1}.${digest}` };
      assert.equal(await readError(await execute(input, tampered), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
      const malformed = { ...confirmation, previewFingerprint: digest };
      assert.equal(await readError(await execute(input, malformed), 400), "CARD_MAINTENANCE_INPUT_INVALID");
      assert.equal(await readError(await reconcile(malformed.previewFingerprint), 400), "CARD_MAINTENANCE_INPUT_INVALID");

      const blocker = await owner.connect();
      let execution: Promise<Response> | null = null;
      let reconciliation: Promise<Response> | null = null;
      let shortConfirmation: CardMaintenancePreview;
      try {
        await blocker.query("BEGIN");
        const session = await blocker.query<Readonly<{ pid: number }>>("SELECT pg_backend_pid() AS pid");
        const blockerPid = session.rows[0]?.pid;
        assert.ok(blockerPid);
        const locked = await blocker.query(
          "SELECT workspace_id FROM sync.workspace_sync_metadata WHERE workspace_id = $1 FOR UPDATE",
          [workspace.workspaceId],
        );
        assert.equal(locked.rowCount, 1);
        // Use a valid short-lived fingerprint to exercise the deadline against the real clock.
        const shortExpiryMs = await databaseTimeMs(owner) + 3_000;
        shortConfirmation = {
          ...confirmation,
          previewFingerprint: buildCardMaintenancePreviewFingerprint(userId, workspace.workspaceId, input, {
            kind: "reset",
            targetName: card.frontText,
            includesAllCards: false,
            cards: [{ card_id: card.cardId }],
            decks: [],
          }, shortExpiryMs),
        };

        execution = execute(input, shortConfirmation);
        const executePid = await waitForBlockedRequest(owner, blockerPid);
        reconciliation = reconcile(shortConfirmation.previewFingerprint);
        await waitForBlockedRequest(owner, executePid);
        assert.ok(await databaseTimeMs(owner) < shortExpiryMs);
        await owner.query(
          "SELECT pg_sleep(greatest($1::double precision / 1000 - extract(epoch FROM clock_timestamp()), 0))",
          [shortExpiryMs],
        );
      } finally {
        try {
          await blocker.query("ROLLBACK");
        } finally {
          blocker.release();
          await Promise.allSettled([execution, reconciliation]);
        }
      }

      assert.equal(await readError(await execution, 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
      assert.equal(await readSettlement(await reconciliation), true);
      assert.equal(await readError(await execute(input, shortConfirmation), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
      assert.equal((await getCard(userId, workspace.workspaceId, card.cardId)).reps, 1);

      const memberId = randomUUID();
      await owner.query("INSERT INTO org.user_settings (user_id) VALUES ($1)", [memberId]);
      try {
        await owner.query(
          "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
          [workspace.workspaceId, memberId],
        );
        assert.equal(await readError(await post("preview", input), 409), "CARD_MAINTENANCE_SHARED");
        assert.equal(await readError(await execute(input, confirmation), 409), "CARD_MAINTENANCE_SHARED");
        assert.equal(await readSettlement(await reconcile(shortConfirmation.previewFingerprint)), true);
      } finally {
        await owner.query("DELETE FROM org.user_settings WHERE user_id = $1", [memberId]);
      }
    });

    await t.test("an existing clean tag can reset zero cards but a vanished tag invalidates confirmation", async () => {
      const card = await makeCard("Unreviewed question?", ["Fresh"]);
      const reset: CardMaintenanceInput = { kind: "resetTag", target: "FRESH" };
      const remove: CardMaintenanceInput = { kind: "removeTag", target: "FRESH" };
      const resetPreview = await preview(reset);
      const removePreview = await preview(remove);
      assert.equal(resetPreview.affectedCardsCount, 0);
      assert.equal(removePreview.affectedCardsCount, 1);
      const noOp = await execute(reset, resetPreview);
      assert.equal(noOp.status, 200, await noOp.clone().text());
      assert.deepEqual(await noOp.json(), { affectedCardsCount: 0 });

      await updateCard(userId, workspace.workspaceId, card.cardId, { tags: [] }, metadata());
      assert.equal(await readError(await execute(reset, resetPreview), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
      assert.equal(await readError(await execute(remove, removePreview), 409), "CARD_MAINTENANCE_PREVIEW_CHANGED");
      for (const kind of ["resetTag", "removeTag"] as const) {
        assert.equal(
          await readError(await post("preview", { kind, target: "Never present" }), 404),
          "CARD_MAINTENANCE_TARGET_NOT_FOUND",
        );
      }
    });
  } finally {
    try {
      if (workspaceId !== null) {
        await owner.query("DELETE FROM org.workspaces WHERE workspace_id = $1", [workspaceId]);
      }
    } finally {
      await owner.end();
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
      if (previousInsecureLocalAuth === undefined) delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
      else process.env.ALLOW_INSECURE_LOCAL_AUTH = previousInsecureLocalAuth;
      resetAuthConfigForTests();
    }
  }
});
