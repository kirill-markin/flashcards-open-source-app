import {
  extractManagedMediaImageReferenceSources,
  extractMarkdownManagedMediaLifecycleReferences,
  isMarkdownComplexityLimitError,
  type ManagedMediaImageReferenceSource,
} from "../../workspacePackages/markdownMedia";
import type { CardRow, CardTextSide } from "../types";
import { appendMarkdownBlock } from "./managedImageSettlement";

/**
 * The card text a snapshot push wants to store, and the stamp it wants to store it under.
 */
export type ManagedImageSnapshotWrite = Readonly<{
  frontText: string;
  backText: string;
  clientUpdatedAt: string;
}>;

/**
 * What the snapshot UPDATE has to write. `clientUpdatedAt` is part of the result rather than left
 * to the caller because a restore is only useful if it also moves the stamp - see WHY A RESTORE
 * MOVES `client_updated_at` below - and a caller that merged the text but kept the client's stamp
 * would produce a row no iOS device ever accepts.
 */
export type ManagedImageSnapshotMergeResult = Readonly<{
  frontText: string;
  backText: string;
  clientUpdatedAt: string;
}>;

/**
 * The managed-media references one request has already put back onto a card.
 *
 * A sync push is a batch, a client queues one whole-card snapshot per action, and nothing
 * coalesces two actions on the same card into one queued operation
 * (`apps/android/.../SyncOutboxLocalStore.kt` inserts a fresh outbox row per call, and the other
 * clients do the same). So rating a card `Again` and then `Good` in one offline session pushes two
 * snapshots of that card in one batch, both frozen with the same stale text. The first one is
 * merged here and becomes the stored row; without this ledger the second one would look exactly
 * like the same device pushing again after catching up, and would take the reference back out.
 *
 * It lives for one request. Two requests are two chances, which is the point of the rule below.
 */
export type ManagedImageRestoreLedger = Readonly<{
  markRestored: (cardId: string, mediaAssetId: string) => void;
  wasRestored: (cardId: string, mediaAssetId: string) => boolean;
}>;

export function createManagedImageRestoreLedger(): ManagedImageRestoreLedger {
  const restoredKeys = new Set<string>();
  const buildKey = (cardId: string, mediaAssetId: string): string =>
    `${cardId.toLowerCase()}\u0000${mediaAssetId.toLowerCase()}`;

  return {
    markRestored: (cardId, mediaAssetId) => {
      restoredKeys.add(buildKey(cardId, mediaAssetId));
    },
    wasRestored: (cardId, mediaAssetId) => restoredKeys.has(buildKey(cardId, mediaAssetId)),
  };
}

const managedMediaSchemeMarker = "fcasset:";

function textMayHoldManagedMedia(text: string): boolean {
  return text.toLowerCase().includes(managedMediaSchemeMarker);
}

function collectReferencedMediaAssetIds(texts: ReadonlyArray<string>): ReadonlySet<string> {
  const mediaAssetIds = new Set<string>();
  for (const text of texts) {
    if (!textMayHoldManagedMedia(text)) {
      continue;
    }
    // Links count, not only images. Turning `![alt](fcasset:x)` into `[alt](fcasset:x)` keeps the
    // asset on the card, and a reference that is still there was never dropped.
    for (const reference of extractMarkdownManagedMediaLifecycleReferences(text)) {
      mediaAssetIds.add(reference.mediaAssetId.toLowerCase());
    }
  }

  return mediaAssetIds;
}

const mediaAssetIdBoundaryCharacterPattern = /[A-Za-z0-9._-]/u;

/**
 * Whether the incoming snapshot names this asset at all, in any shape the Markdown parser does not
 * read as an active destination: an HTML `<img src="fcasset:...">`, a reference-style definition
 * under a label, the same reference quoted inside a code fence. None of those is a destination the
 * extractor above returns, and each of them is still text naming the asset, so appending a second
 * copy of it is a worse answer than leaving that side alone. A mention in any shape counts as still
 * referenced.
 *
 * A mention is not evidence that the sender holds the image. The needle stops at the id, so
 * `fcasset:<id>?state=pending` is a mention of `fcasset:<id>` - see THE LIFECYCLE-STATE MISMATCH
 * below for what that case does and why it is not handled here.
 *
 * A stored media asset id can be a prefix of another one, so a match only counts when the id ends
 * where the needle ends.
 */
function textsMentionMediaAssetId(
  texts: ReadonlyArray<string>,
  mediaAssetId: string,
): boolean {
  const needle = `${managedMediaSchemeMarker}${mediaAssetId}`;
  for (const text of texts) {
    const searchableText = text.toLowerCase();
    let matchIndex = searchableText.indexOf(needle);
    while (matchIndex !== -1) {
      const characterAfterMatch = searchableText[matchIndex + needle.length];
      if (
        characterAfterMatch === undefined
        || !mediaAssetIdBoundaryCharacterPattern.test(characterAfterMatch)
      ) {
        return true;
      }
      matchIndex = searchableText.indexOf(needle, matchIndex + 1);
    }
  }

  return false;
}

function bumpClientUpdatedAtByOneMillisecond(clientUpdatedAt: string): string {
  return new Date(new Date(clientUpdatedAt).getTime() + 1).toISOString();
}

function collectStoredImageReferencesBySide(
  stored: Readonly<{ frontText: string; backText: string }>,
): ReadonlyMap<CardTextSide, ReadonlyArray<ManagedMediaImageReferenceSource>> {
  const referencesBySide = new Map<CardTextSide, ReadonlyArray<ManagedMediaImageReferenceSource>>();
  referencesBySide.set(
    "front",
    textMayHoldManagedMedia(stored.frontText)
      ? extractManagedMediaImageReferenceSources(stored.frontText)
      : [],
  );
  referencesBySide.set(
    "back",
    textMayHoldManagedMedia(stored.backText)
      ? extractManagedMediaImageReferenceSources(stored.backText)
      : [],
  );

  return referencesBySide;
}

function restoreReferencesOntoSide(
  incomingText: string,
  references: ReadonlyArray<ManagedMediaImageReferenceSource>,
): string | null {
  let mergedText = incomingText;
  for (const reference of references) {
    mergedText = appendMarkdownBlock(mergedText, reference.source);
  }

  // A restored reference has to survive as an active image destination in the text it lands in. It
  // does not when the incoming side ends inside an unterminated fence or HTML block, which would
  // swallow the appended block into code. There is no safe repair for that - editing a person's
  // Markdown to close their fence is a worse outcome than the one being prevented - so the side is
  // left exactly as the client sent it.
  const mergedDestinations = new Set(
    extractManagedMediaImageReferenceSources(mergedText).map((reference) => reference.destination),
  );
  for (const reference of references) {
    if (!mergedDestinations.has(reference.destination)) {
      return null;
    }
  }

  return mergedText;
}

/**
 * Put back the managed-media images a snapshot push would drop, when the pushing device cannot have
 * known about them.
 *
 * WHY THIS EXISTS. The backend writes managed images straight into card text: the AI image tool
 * appends a pending marker and the promotion job rewrites it to a ready reference
 * (./managedImageSettlement.ts), each stamped `client_updated_at = max(now, stored + 1ms)`. Every
 * client is offline-first and pushes whole card snapshots, freezing the payload into its outbox at
 * the moment the action is queued, so a device that has not pulled that change sends the text it
 * still holds - text with no reference in it - stamped with the moment of its own action. A review
 * is the ordinary trigger and needs no editing at all. That stamp is newer, so it wins
 * last-write-wins (../../sync/conflicts/lww.ts) and the snapshot UPDATE in ../mutations.ts stores
 * text the image is missing from. The image disappears from a card the person only reviewed, and
 * nothing brings it back: the media asset row survives, but the only record of which card it
 * belonged to was the reference that was just overwritten.
 *
 * WHAT "THE SERVER STILL HOLDS" MEANS, AND WHY IT IS THE TEXT. The stored `front_text`/`back_text`
 * is the whole truth here, and `content.media_assets` cannot be: that table carries no card id, no
 * side, and no alt text, so it cannot say which card an asset belongs to or where on it. The card
 * text is also what every client renders, which makes a reference in it the thing a person would
 * see vanish. Every managed lifecycle state counts as something to restore - ready, pending and
 * failed - because a dropped pending marker is worse than a dropped ready one: settlement then
 * finds no marker to rewrite, fails the promotion job, and the generated image is lost before it is
 * ever shown. That is only about a reference the incoming snapshot dropped altogether; when the two
 * sides name one asset in DIFFERENT states nothing is restored at all, which is THE LIFECYCLE-STATE
 * MISMATCH below.
 *
 * WHAT COUNTS AS DROPPED. A stored image reference whose media asset id appears nowhere in the
 * incoming snapshot, on either side. "Nowhere" is deliberately wider than an active Markdown image
 * destination: a link counts, and so does the asset id written in any other shape at all - see
 * `textsMentionMediaAssetId` above for which shapes and why. Moving an image from the back to the
 * front, or turning it into a link, is a person editing their card and is left alone.
 *
 * THE LIFECYCLE-STATE MISMATCH, which this does not handle, and which is likelier than any of the
 * hand-written shapes above. `fcasset:<id>`, `fcasset:<id>?state=pending` and
 * `fcasset:<id>?state=failed` all parse to the same media asset id
 * (`managedMediaLifecycleUrlPattern` in ../../workspacePackages/markdownMedia.ts), and the mention
 * check matches the id up to its boundary character, so an incoming snapshot carrying any of them
 * reads as still referencing the asset. Nothing is dropped, nothing is restored, the stamp is not
 * moved, and the state the snapshot carries is stored over the state the server held.
 *
 * The direction that costs something is a device pushing the pending marker over a settled ready
 * reference, and it is an ordinary sequence rather than a corner. The marker goes into card text
 * and is published as a hot change before settlement rewrites it
 * (`appendPendingManagedImageToCardSideInExecutor` in ./managedImageSettlement.ts), so any device
 * that pulled inside that window is holding a mention of an image it has never had. Nothing
 * re-settles the card afterwards: the promotion job that rewrote the marker has already succeeded
 * and does not run again. And a non-ready reference is a placeholder on the clients, not an image -
 * web renders "Image is being prepared. It will appear soon." and returns before it ever fetches
 * the blob (`ManagedMediaReference` in
 * apps/web/src/screens/review/components/card/managedMedia/ManagedMediaReference.tsx). The image
 * sits finished in storage and the card promises it is on its way, permanently.
 *
 * Left alone on purpose. It is pre-existing - the same push stored the same marker before this
 * function existed - and restoring across a state mismatch would rewrite a person's text in a case
 * nothing here otherwise touches, which is a decision of its own. Tracked separately.
 *
 * WHERE A RESTORED REFERENCE LANDS. Appended as a trailing block on the side the server held it on,
 * in stored order, as the exact source text of the stored node so the alt text survives. Trailing
 * is defensible because it is where the backend put the image in the first place
 * (`appendManagedImageToCardText`): the person gets the card they would have had if the device had
 * pulled before pushing. Splicing it back into its old position is not available - the incoming
 * prose may have been rewritten around it, and there is nothing to anchor to - and any attempt to
 * do so would edit text a person wrote. Their prose is never touched; only a block is added. One
 * consequence worth naming because it is not obvious: a side that held two images and lost the
 * first one gets that one back after the second, so undoing the deletion also reorders the image
 * that survived. Appending is the only placement available, so there is nothing better to do. A
 * side that held the SAME asset twice - only reachable by hand-editing, since the append refuses a
 * second copy - gets one copy back rather than two, because the drop is tracked per asset id. That
 * is the better answer anyway and is left as it is.
 *
 * THE DELIBERATE-DELETION RULE, and the one decision this function turns on. Nothing in the system
 * records what a device has pulled: `sync.workspace_replicas` holds `last_seen_at` and no cursor, a
 * pull echoes `nextHotChangeId` back to the client without storing it, and a push carries no
 * indication of what its sender had already seen. So "this device never saw the image" and "this
 * person deleted the image" arrive as byte-identical requests and cannot be told apart from one
 * push. What can be told apart is whether the pushing replica produced the text now stored: if
 * `last_modified_by_replica_id` on the stored row is the replica pushing now, that text is text
 * this device itself sent, the reference was in it, and taking it out is a decision - honoured
 * immediately. Otherwise the reference arrived from somewhere this device may never have seen, and
 * it is restored.
 *
 * That rule is exactly one free restore per device per card state, and it terminates. A person
 * deleting a generated image from the device that pulled it is the case it gets wrong: the stored
 * text was written by the AI chat replica, not by their device, so the first deletion is undone.
 * They pull the merged card, delete it again, and this time the stored row is theirs and the
 * deletion stands. Two deletes instead of one. In the other direction the loss is permanent and
 * silent: an image the person never chose to remove disappears and cannot be recovered, because
 * nothing else records which card it was on. A recoverable annoyance is the cheaper failure, so the
 * rule biases towards restoring.
 *
 * WHY A RESTORE MOVES `client_updated_at`. A restore is only worth anything if the device
 * converges on the merged text before it queues its next snapshot of that card, and each client
 * decides that with its own comparator. Web and Android apply a pulled card unconditionally
 * (`applyHotSyncPage` in apps/web/src/localDb/cards/workspace/index.ts, `applyPullChanges` in
 * apps/android/.../data/local/cloud/sync/SyncHotStateLocalStore.kt). iOS does not: the pull routes
 * through `SyncApplier.applySyncBootstrapEntry`, which runs the same last-write-wins tuple locally
 * and skips a pulled card its own row outranks. The merge stores the device's own
 * `client_updated_at` and `last_operation_id`, so both of those tie against the row the device
 * already holds and the whole decision falls to the replica id - and there the two sides disagree
 * by construction: iOS writes its installation id into the local column
 * (`CardStore+Write.swift`) while the server writes the replica derived from it
 * (`toUuidFromSeed(workspaceId:installationId)` in ../../sync/identity/replica.ts). Two unrelated
 * lowercase UUIDs, compared as bytes, so for about half of all (workspace, installation) pairs the
 * local row wins that comparison forever and the device would skip its own merged card.
 *
 * So a restore stamps the row one millisecond past the snapshot that caused it. That is strictly
 * newer than the row the device holds, so iOS decides on the timestamp and never reaches the
 * tie-break, and the other two had no comparison to lose in the first place. The device's own
 * `last_operation_id` is stored unchanged, which keeps the push idempotent and keeps the row
 * traceable to the operation that produced it. One millisecond rather than settlement's
 * `max(now, stored + 1ms)` on
 * purpose: `now` is the moment of the push, which is later than every snapshot the same offline
 * session already queued, so stamping it would make each later snapshot in the same batch lose
 * last-write-wins outright and silently drop the review it was carrying.
 *
 * The millisecond is not free either, and because the comparison has millisecond resolution
 * (`compareLwwMetadata` in ../../sync/conflicts/lww.ts) exactly two later writes pay for it, which
 * closes the set. A write stamped the SAME millisecond as the causing snapshot used to tie and
 * resolve on an arbitrary replica-id then operation-id comparison, and now loses every time. A
 * write stamped exactly one millisecond after it used to beat the causing snapshot outright, and
 * now ties on the timestamp and falls through to that same arbitrary comparison, so it loses about
 * half the time - another device's genuinely later write as readily as the same device's next entry
 * in the same batch. The concrete one: two snapshots of a card queued a millisecond apart in one
 * offline session, the second comes back `ignored`, all three clients count `ignored` as
 * acknowledged and delete the outbox row, and that review's scheduling is gone. Two milliseconds or
 * more after the snapshot is unaffected, and anything stamped before it had already lost.
 *
 * A merge that restored nothing returns the client's stamp untouched.
 *
 * WHY THIS RUNS BEFORE THE TOMBSTONE BRANCH. A snapshot that deletes the card is merged like any
 * other, so a delete that also dropped a reference stores a reference into text nobody will render.
 * That is the right order anyway: a deletion is not a decision about text, and the reference
 * sitting in the tombstoned row is what lets the image come back with the card if a later snapshot
 * brings it back alive.
 *
 * THE NARROWER RESIDUAL, stated because it is the one that still loses data. The restore protects a
 * card against every stale snapshot that reaches this request and nothing beyond it. A stale
 * snapshot of the same card arriving in a LATER request finds a stored row written by the pushing
 * replica, is read as a decision, and takes the reference out. Two things produce one.
 *
 * The likelier is a pull that never lands. All three clients delete acknowledged outbox rows as
 * soon as the push returns and pull only afterwards (`pushOutboxBatches` in
 * apps/ios/.../Cloud/Sync/Runner/CloudSyncPush.swift, `pushOutbox` in
 * apps/web/src/appData/sync/remote/pushOutbox.ts, the push loop in
 * apps/android/.../repository/cloudsync/sync/CloudSyncRunner.kt), and a pull that throws ends the
 * cycle with nothing rolled back and nothing re-enqueued. The device never learns the merged text,
 * the next write it queues on that card freezes the stale text again, and the next push honours it.
 * One dropped pull on a flaky network is enough.
 *
 * The other is outbox paging, which splits snapshots already frozen at merge time across two
 * requests. iOS and web send 100 operations per request and loop straight into the next page with
 * no pull between them, so the second request arrives at 101 queued operations; Android sends 200
 * (`outboxBatchLimit` in apps/android/.../data/local/cloud/sync/SyncOutboxLocalStore.kt) and
 * ordinarily breaks out to pull before the next page, so it needs 201 - except while
 * `hasSkippedBootstrapHotRows` is set (CloudSyncRunner.kt:108), where it loops straight into the
 * next page with no pull between, exactly like the other two. Pulling between pages does not rescue
 * it either, because a snapshot already frozen into the outbox still carries the stale text.
 *
 * Closing either needs the server to record what each replica has been sent, which is a pull-path
 * change and a schema change; it is not built here.
 */
export function mergeManagedImageReferencesIntoCardSnapshot(
  storedRow: CardRow,
  incoming: ManagedImageSnapshotWrite,
  pushingReplicaId: string,
  ledger?: ManagedImageRestoreLedger,
): ManagedImageSnapshotMergeResult {
  const unchanged: ManagedImageSnapshotMergeResult = {
    frontText: incoming.frontText,
    backText: incoming.backText,
    clientUpdatedAt: incoming.clientUpdatedAt,
  };

  if (
    !textMayHoldManagedMedia(storedRow.front_text)
    && !textMayHoldManagedMedia(storedRow.back_text)
  ) {
    return unchanged;
  }

  const replicaAuthoredStoredText = storedRow.last_modified_by_replica_id === pushingReplicaId;

  try {
    const storedReferencesBySide = collectStoredImageReferencesBySide({
      frontText: storedRow.front_text,
      backText: storedRow.back_text,
    });
    const incomingMediaAssetIds = collectReferencedMediaAssetIds([
      incoming.frontText,
      incoming.backText,
    ]);

    const incomingTexts = [incoming.frontText, incoming.backText];
    let restoredCount = 0;
    const mergedTextBySide = new Map<CardTextSide, string>([
      ["front", incoming.frontText],
      ["back", incoming.backText],
    ]);

    for (const [side, storedReferences] of storedReferencesBySide) {
      const droppedReferences: Array<ManagedMediaImageReferenceSource> = [];
      const droppedMediaAssetIds = new Set<string>();
      for (const reference of storedReferences) {
        const normalizedMediaAssetId = reference.mediaAssetId.toLowerCase();
        if (
          incomingMediaAssetIds.has(normalizedMediaAssetId)
          || droppedMediaAssetIds.has(normalizedMediaAssetId)
          || textsMentionMediaAssetId(incomingTexts, normalizedMediaAssetId)
        ) {
          continue;
        }
        if (
          replicaAuthoredStoredText
          && ledger?.wasRestored(storedRow.card_id, normalizedMediaAssetId) !== true
        ) {
          continue;
        }

        droppedMediaAssetIds.add(normalizedMediaAssetId);
        droppedReferences.push(reference);
      }

      if (droppedReferences.length === 0) {
        continue;
      }

      const incomingText = mergedTextBySide.get(side) ?? "";
      const mergedText = restoreReferencesOntoSide(incomingText, droppedReferences);
      if (mergedText === null) {
        continue;
      }

      mergedTextBySide.set(side, mergedText);
      for (const mediaAssetId of droppedMediaAssetIds) {
        restoredCount += 1;
        ledger?.markRestored(storedRow.card_id, mediaAssetId);
      }
    }

    if (restoredCount === 0) {
      return unchanged;
    }

    return {
      frontText: mergedTextBySide.get("front") ?? incoming.frontText,
      backText: mergedTextBySide.get("back") ?? incoming.backText,
      clientUpdatedAt: bumpClientUpdatedAtByOneMillisecond(incoming.clientUpdatedAt),
    };
  } catch (error) {
    // Markdown past the parser's nesting limit is the only failure this can raise, and a sync push
    // must not be rejected over it. The push stores what the client sent, which is the behaviour
    // that shipped before this function existed.
    if (isMarkdownComplexityLimitError(error)) {
      return unchanged;
    }
    throw error;
  }
}
