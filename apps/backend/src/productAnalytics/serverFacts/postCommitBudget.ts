// The wall clock one request may spend on analytics after its product transaction committed.
//
// Every server-derived producer does its work post-commit, on the request's own clock, and every
// operation it does there costs up to ~4s: up to analyticsPoolConnectionTimeoutMs (2s, ../writer.ts)
// acquiring an analytics connection, then up to 2s under the SET LOCAL statement_timeout = '2s' that
// runAnalyticsWrite sets. That is paid for a chunk the writer stores just as much as for one it
// refuses, so no stop rule keyed on refusal alone bounds it.
//
// A budget per producer does not bound it either, because per-producer budgets sum. Two of the four
// review write paths run more than one producer in sequence, and the guest upgrade runs four
// operations across three producers. That is the design this file rejects rather than one it
// replaces: had the review answers drain been given a bound of its own - even a 2.0s one, so 6.0s
// with the chunk already in flight - the guest upgrade would have paid 8.0s (content drain) + 6.0s
// (review drain) + 4.0s (identity link) + 4.0s (guest_upgrade_completed) = 22.0s against the 29s API
// Gateway integration timeout, leaving 7.0s for cold start, auth and the merge itself, which is the
// slowest write in the product; the sync push would have paid 14.0s. Every producer added afterwards
// would have re-broken the bound again.
//
// One deadline shared by every stage that draws on it bounds the tail at this budget plus the one
// operation already in flight when it runs out, however many stages there are:
//
//   4.0s budget + 4.0s in-flight operation = 8.0s, for any number of gated stages.
//
// Against publicRestApiDefaultIntegrationTimeoutSeconds (29s) that leaves 21.0s for cold start, auth
// and the product transaction itself on the sync push, the review history import and every
// content-only path alike. The guest upgrade is the one path above that figure, by choice: its
// analytics identity link is exempt from the stop and always attempted, because it is the one write
// here with no repair path, so that path's tail is 8.0s + 4.0s = 12.0s and it still keeps 17.0s.
// ../../guestAuth/index.ts states the exemption and what it buys.
//
// What each path paid before this file existed: 16.0s on the guest upgrade - an 8.0s content drain
// plus its two 4.0s writes - 8.0s on the sync push, and nothing at all on the review history import,
// which reported no analytics. The import is therefore the one path that pays more than before, and
// it pays it for a ceiling that holds no matter what is added next.
//
// Two limits of that ceiling, named rather than papered over. First, the ~4s per-operation figure
// counts pool.connect() and the insert under the statement timeout; it does not count the BEGIN /
// SET LOCAL / COMMIT round trips around the insert, nor the first `getAnalyticsPool()` of a cold
// container, whose getDatabaseUrl() reaches Secrets Manager with SDK timeouts and retries of its own
// (the product transaction that just committed has normally resolved that already, since
// ../../database/config.ts memoizes it process-wide, but nothing here guarantees it). The first
// post-commit operation of a cold invocation can therefore run past 4s and carry the whole tail past
// the figures above, so read them as the shape of the bound and not as an unconditional cap.
// Second, the budget bounds only the stages wired to it - the content creations drain, the review
// answers drain and the guest upgrade's completion event. recordFriendshipCreatedAnalytics
// (../../community/analytics.ts) runs two sequential post-commit writes, and the catalog install and ai
// message producers one each, none of them drawing on a budget, so a request that reaches one of
// those pays its cost outside this bound; wiring them in is separate work.
//
// The budget is the 4.0s the content creations drain already carried on its own, so that drain loses
// no healthy-case capacity: a healthy chunk is one unnest insert on a warm pooled connection, so 4s
// still covers tens of thousands of facts before anything is skipped, and a drain that cannot finish
// inside it was already threatening its request.
const postCommitAnalyticsBudgetMs = 4_000;

/**
 * The remaining post-commit analytics clock of one request, shared by every stage that draws on it.
 *
 * A request that runs more than one post-commit analytics stage must create exactly one of these and
 * hand it to every stage, otherwise the stages are bounded separately again and their costs sum.
 */
export type PostCommitAnalyticsBudget = Readonly<{
  /**
   * Whether there is clock left to start one more analytics operation, and never a check made during
   * one: an operation that started is always allowed to finish, which is why the guaranteed ceiling
   * is the budget plus one operation rather than the budget alone.
   *
   * The first call starts the clock rather than the constructor doing it. A budget has to be created
   * before the transaction it will follow, because the wrappers that drain a transaction are the
   * ones that open it - and if the clock ran from then, the product transaction's own duration would
   * spend it, so the slowest merges and the largest imports, which are exactly the ones whose
   * analytics is worth most, would be the ones that reported nothing.
   */
  hasTimeForAnotherOperation: () => boolean;
}>;

export function createPostCommitAnalyticsBudget(): PostCommitAnalyticsBudget {
  let deadlineAtMs: number | null = null;

  return {
    hasTimeForAnotherOperation: (): boolean => {
      if (deadlineAtMs === null) {
        deadlineAtMs = Date.now() + postCommitAnalyticsBudgetMs;
        return true;
      }

      return Date.now() < deadlineAtMs;
    },
  };
}
