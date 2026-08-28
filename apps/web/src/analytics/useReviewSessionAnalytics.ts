import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewFilter } from "../types";
import { registerAnalyticsPageHideCollector, track } from "./client";
import type { AnalyticsDeckScope, AnalyticsReviewSessionEndReason } from "./events";

type ActiveReviewSession = {
  startedAtMs: number;
  answeredCount: number;
};

type UseReviewSessionAnalyticsParams = Readonly<{
  reviewFilter: ReviewFilter | null;
  isReviewQueueEmpty: boolean;
}>;

type UseReviewSessionAnalyticsResult = Readonly<{
  recordReviewAnswerSettled: (wasAnswerSaved: boolean) => void;
  recordReviewAnswerStarted: () => void;
}>;

export function toAnalyticsDeckScope(reviewFilter: ReviewFilter): AnalyticsDeckScope {
  switch (reviewFilter.kind) {
    case "allCards":
      return "all";
    case "deck":
      return "deck";
    case "tags":
      return "filter";
  }
}

/**
 * Tracks one review session per review scope. A session ends `completed` when the queue empties
 * after at least one answer, `abandoned` when the user leaves the screen, and `interrupted` when the
 * review scope changes underneath it or the page goes away.
 *
 * The page-away case is why this hook carries its own unload handling. Closing the tab, reloading,
 * or navigating off the origin mid-review is an ordinary way to end a web review session, and React
 * runs no effect cleanup for any of it. Without this, `review_session_started` would systematically
 * outnumber `review_session_ended`, and `answered_count` and `duration_ms` — the only quantitative
 * fields in the whole client catalog — would only ever describe sessions that ended by in-app
 * navigation. `product_events` is append-only, so that bias would never be correctable.
 *
 * An answer is announced to this hook before it is submitted and again once it settles, because the
 * review screen empties its queue optimistically and only then awaits the IndexedDB write. Treating
 * the empty queue as a finished session while that write is in flight would close every session one
 * answer short and leave the settled answer to open a phantom second one.
 */
export function useReviewSessionAnalytics(
  params: UseReviewSessionAnalyticsParams,
): UseReviewSessionAnalyticsResult {
  const { reviewFilter, isReviewQueueEmpty } = params;
  const deckScope = reviewFilter === null ? null : toAnalyticsDeckScope(reviewFilter);
  const sessionRef = useRef<ActiveReviewSession | null>(null);
  const isUnmountingRef = useRef<boolean>(false);
  const isEndedByPageHideRef = useRef<boolean>(false);
  const pendingAnswerCountRef = useRef<number>(0);
  const [settledAnswerRevision, setSettledAnswerRevision] = useState<number>(0);

  const endSession = useCallback(function endSession(endReason: AnalyticsReviewSessionEndReason): void {
    const session = sessionRef.current;
    if (session === null) {
      return;
    }

    sessionRef.current = null;
    track({
      name: "review_session_ended",
      endReason,
      answeredCount: session.answeredCount,
      durationMs: Math.max(0, Date.now() - session.startedAtMs),
    });
  }, []);

  const startSession = useCallback(function startSession(nextDeckScope: AnalyticsDeckScope): void {
    isEndedByPageHideRef.current = false;
    sessionRef.current = {
      startedAtMs: Date.now(),
      answeredCount: 0,
    };
    track({ name: "review_session_started", deckScope: nextDeckScope });
  }, []);

  // Declared before the session effect on purpose: React runs cleanups in declaration order, so this
  // flag is already set when the session cleanup below decides between `abandoned` and `interrupted`.
  useEffect(() => {
    isUnmountingRef.current = false;
    return (): void => {
      isUnmountingRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (deckScope === null) {
      return undefined;
    }

    startSession(deckScope);
    return (): void => {
      endSession(isUnmountingRef.current ? "abandoned" : "interrupted");
    };
  }, [deckScope, endSession, startSession]);

  // Completion is decided only while no answer is in flight, and `settledAnswerRevision` re-runs the
  // decision once one settles, so the count that ships with `completed` always includes the answer
  // that emptied the queue. The re-run reads the queue state committed after the submit, which is
  // what keeps a queue refilled by the follow-up chunk load from being reported as finished.
  useEffect(() => {
    if (
      isReviewQueueEmpty === false
      || pendingAnswerCountRef.current > 0
      || (sessionRef.current?.answeredCount ?? 0) === 0
    ) {
      return;
    }

    endSession("completed");
  }, [endSession, isReviewQueueEmpty, settledAnswerRevision]);

  useEffect(() => {
    function endSessionForPageHide(): void {
      if (sessionRef.current === null) {
        return;
      }

      isEndedByPageHideRef.current = true;
      endSession("interrupted");
    }

    // The page came back and this screen is still mounted, so the user resumes reviewing under a
    // fresh session rather than inside one whose end has already been reported. Guarded by the flag,
    // so a session that ended `completed` is not silently restarted, and so the two restore signals
    // below cannot start two sessions.
    function restartSessionAfterPageHide(): void {
      if (isEndedByPageHideRef.current === false || sessionRef.current !== null || deckScope === null) {
        return;
      }

      startSession(deckScope);
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        restartSessionAfterPageHide();
      }
    }

    // The hidden half is deliberately not a listener of its own. The analytics client runs every
    // registered collector, then persists, then flushes, so this event is in the batch the tab hide
    // itself ships instead of waiting for a later trigger — and for the hide that is a sign-out
    // navigation, the later trigger is a boot whose identity reset discards the event.
    const unregisterPageHideCollector = registerAnalyticsPageHideCollector(endSessionForPageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // A back-forward cache restore is the other way a hidden page becomes live again.
    window.addEventListener("pageshow", restartSessionAfterPageHide);
    return (): void => {
      unregisterPageHideCollector();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", restartSessionAfterPageHide);
    };
  }, [deckScope, endSession, startSession]);

  const recordReviewAnswerStarted = useCallback(function recordReviewAnswerStarted(): void {
    pendingAnswerCountRef.current += 1;
  }, []);

  const recordReviewAnswerSettled = useCallback(function recordReviewAnswerSettled(
    wasAnswerSaved: boolean,
  ): void {
    pendingAnswerCountRef.current = Math.max(0, pendingAnswerCountRef.current - 1);
    // A submit that did not save is rolled back into the queue and already reported by
    // `review_answer_failed`, so it must leave behind neither a counted answer nor a completion.
    if (wasAnswerSaved === false) {
      return;
    }

    // The other half of the phantom-session defect: an answer that settles after its session was
    // already reported must not resurrect one. Only a screen still mounted and still in the
    // foreground can legitimately be mid-review with no open session — the queue refilled after a
    // `completed` — and an unmount or a page hide mid-submit has already reported the answer's real
    // session, so the settled answer belongs to no session at all.
    if (sessionRef.current === null) {
      if (deckScope === null || isUnmountingRef.current || document.visibilityState !== "visible") {
        return;
      }

      startSession(deckScope);
    }

    const session = sessionRef.current;
    if (session !== null) {
      session.answeredCount += 1;
    }

    setSettledAnswerRevision((currentRevision) => currentRevision + 1);
  }, [deckScope, startSession]);

  return { recordReviewAnswerSettled, recordReviewAnswerStarted };
}
