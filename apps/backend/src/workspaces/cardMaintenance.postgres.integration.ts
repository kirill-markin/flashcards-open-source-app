import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { resetAuthConfigForTests } from "../auth/config";
import { createCard, getCard, submitReview, updateCard } from "../cards";
import { createDeck, getDeck, updateDeck } from "../decks";
import { createApp } from "../server/app";
import { buildSystemWorkspaceReplicaId } from "../sync/identity/replica";
import { createWorkspaceForUser } from "./create";
import type { CardMaintenanceInput, CardMaintenancePreview } from "./cardMaintenance";

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
    const post = (action: "preview" | "execute", input: object): Promise<Response> => Promise.resolve(
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
