// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReviewRatingReactions,
  type UseReviewRatingReactionsResult,
} from "./useReviewRatingReactions";

type ReviewRatingReactionHarnessProps = Readonly<{
  onResult: (result: UseReviewRatingReactionsResult) => void;
}>;

function ReviewRatingReactionHarness(props: ReviewRatingReactionHarnessProps): ReactElement {
  const { onResult } = props;
  const result = useReviewRatingReactions();

  useEffect(() => {
    onResult(result);
  }, [onResult, result]);

  return (
    <div>
      {result.events.map((event) => (
        <span key={event.id} data-testid="review-reaction-event" data-event-id={event.id} />
      ))}
    </div>
  );
}

describe("useReviewRatingReactions", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestResult: UseReviewRatingReactionsResult | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.72);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    latestResult = null;
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot !== null) {
      act(() => currentRoot.unmount());
    }

    container?.remove();
    container = null;
    root = null;
    latestResult = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function renderHarness(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Review reaction test root is not ready");
    }

    return act(async () => {
      currentRoot.render(
        <ReviewRatingReactionHarness
          onResult={(result) => {
            latestResult = result;
          }}
        />,
      );
    });
  }

  function requireLatestResult(): UseReviewRatingReactionsResult {
    if (latestResult === null) {
      throw new Error("Review reaction hook result was not rendered");
    }

    return latestResult;
  }

  it("cleans up retained reactions after batched emissions trim older events", async () => {
    await renderHarness();
    const { emitReaction } = requireLatestResult();

    await act(async () => {
      emitReaction(2);
      emitReaction(2);
      emitReaction(2);
      emitReaction(2);
    });

    expect(requireLatestResult().events.map((event) => event.id)).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);

    await act(async () => {
      vi.advanceTimersByTime(1830);
    });

    expect(requireLatestResult().events).toHaveLength(0);
  });
});
