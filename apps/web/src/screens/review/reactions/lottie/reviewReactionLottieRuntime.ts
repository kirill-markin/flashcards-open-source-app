import type { AnimationItem, LottiePlayer } from "lottie-web";
import {
  reviewReactionLottieAnimationUrl,
  reviewReactionLottieVariants,
  type ReviewReactionLottieVariant,
} from "./reviewReactionLottieCatalog";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewReactionLottieVariantRecord<Value> = Readonly<Record<ReviewReactionLottieVariant, Value | null>>;
type ReviewReactionLottieAnimationDataByVariant = ReviewReactionLottieVariantRecord<object>;
type ReviewReactionLottieAnimationPromiseByVariant = ReviewReactionLottieVariantRecord<Promise<object>>;
type ReviewReactionLottiePreparedRenderByVariant = ReviewReactionLottieVariantRecord<ReviewReactionLottiePreparedRender>;
type ReviewReactionLottiePreparedRenderPromiseByVariant = (
  ReviewReactionLottieVariantRecord<Promise<ReviewReactionLottiePreparedRender>>
);
type ReviewReactionLottieFailureByVariant = ReviewReactionLottieVariantRecord<unknown>;

export type ReviewReactionLottieAsset = Readonly<{
  animationData: object;
  player: LottiePlayer;
}>;

export type ReviewReactionLottieAssetFailure = Readonly<{
  error: unknown;
  variant: ReviewReactionLottieVariant;
}>;

export type ReviewReactionLottiePreloadResult = Readonly<{
  failures: ReadonlyArray<ReviewReactionLottieAssetFailure>;
}>;

export type ReviewReactionLottieMountedRender = Readonly<{
  animationItem: AnimationItem;
}>;

type ReviewReactionLottiePreparedRender = Readonly<{
  animationData: object;
  animationItem: AnimationItem;
  container: HTMLDivElement;
  player: LottiePlayer;
  variant: ReviewReactionLottieVariant;
}>;

type ReviewReactionLottieWorkOwner = Readonly<{
  controller: AbortController;
  removeRecoveryAbortListener: () => void;
}>;

function makeEmptyReviewReactionLottieVariantRecord<Value>(): ReviewReactionLottieVariantRecord<Value> {
  return Object.fromEntries(
    reviewReactionLottieVariants.map((variant): [ReviewReactionLottieVariant, null] => [variant, null]),
  ) as ReviewReactionLottieVariantRecord<Value>;
}

function isReviewReactionLottieAnimationData(animationData: unknown): animationData is object {
  return typeof animationData === "object" && animationData !== null && !Array.isArray(animationData);
}

function makeReviewReactionLottieRenderEventError(
  eventName: "data_failed" | "error",
  variant: ReviewReactionLottieVariant,
): Error {
  return new Error(
    `Review reaction Lottie render instance for variant ${variant} emitted ${eventName}.`,
  );
}

function reportReviewReactionLottiePrewarmFailure(
  error: unknown,
  variant: ReviewReactionLottieVariant | null,
): void {
  console.warn("Review reaction Lottie prewarm failed.", {
    error,
    variant,
  });
}

export class ReviewReactionLottieRuntime {
  private playerPromise: Promise<LottiePlayer> | null = null;
  private playerReady = false;
  private animationDataByVariant: ReviewReactionLottieAnimationDataByVariant = (
    makeEmptyReviewReactionLottieVariantRecord<object>()
  );
  private animationPromiseByVariant: ReviewReactionLottieAnimationPromiseByVariant = (
    makeEmptyReviewReactionLottieVariantRecord<Promise<object>>()
  );
  private preparedRenderByVariant: ReviewReactionLottiePreparedRenderByVariant = (
    makeEmptyReviewReactionLottieVariantRecord<ReviewReactionLottiePreparedRender>()
  );
  private preparedRenderPromiseByVariant: ReviewReactionLottiePreparedRenderPromiseByVariant = (
    makeEmptyReviewReactionLottieVariantRecord<Promise<ReviewReactionLottiePreparedRender>>()
  );
  private failureByVariant: ReviewReactionLottieFailureByVariant = (
    makeEmptyReviewReactionLottieVariantRecord<unknown>()
  );
  private reservedRenderByEventId: Map<string, ReviewReactionLottiePreparedRender> = (
    new Map<string, ReviewReactionLottiePreparedRender>()
  );
  private mountedRenderEventIds: Set<string> = new Set<string>();
  private releaseRequestedEventIds: Set<string> = new Set<string>();
  private offscreenRoot: HTMLDivElement | null = null;
  private stateGeneration = 0;
  private workOwner: ReviewReactionLottieWorkOwner | null = null;

  isAssetReady(variant: ReviewReactionLottieVariant): boolean {
    return this.playerReady && this.preparedRenderByVariant[variant] !== null;
  }

  assetFailure(variant: ReviewReactionLottieVariant): unknown | null {
    return this.failureByVariant[variant];
  }

  resetStateForTests(): void {
    if (this.workOwner !== null) {
      this.stopAndClearWork(
        this.workOwner,
        new DOMException("Review reaction Lottie state was reset", "AbortError"),
      );
      return;
    }

    this.clearState();
  }

  async loadAsset(variant: ReviewReactionLottieVariant): Promise<ReviewReactionLottieAsset> {
    const signal = this.getWorkSignal();
    signal.throwIfAborted();
    const preparedRender = await this.prewarmVariant(variant, signal);
    signal.throwIfAborted();
    return {
      animationData: preparedRender.animationData,
      player: preparedRender.player,
    };
  }

  async prewarmAssets(): Promise<ReviewReactionLottiePreloadResult> {
    const signal = this.getWorkSignal();
    signal.throwIfAborted();
    const settledPreparedRenders = await Promise.allSettled(
      reviewReactionLottieVariants.map((variant) => this.prewarmVariant(variant, signal)),
    );
    signal.throwIfAborted();
    const failures: Array<ReviewReactionLottieAssetFailure> = [];

    for (const [index, settledPreparedRender] of settledPreparedRenders.entries()) {
      if (settledPreparedRender.status === "rejected") {
        const error: unknown = settledPreparedRender.reason;
        failures.push({
          error,
          variant: reviewReactionLottieVariants[index],
        });
      }
    }

    return { failures };
  }

  startPrewarm(recoverySignal: AbortSignal): () => void {
    const owner = this.createWorkOwner(recoverySignal);
    if (owner.controller.signal.aborted) {
      return () => undefined;
    }

    void this.prewarmAssets()
      .then((result: ReviewReactionLottiePreloadResult): void => {
        owner.controller.signal.throwIfAborted();
        for (const failure of result.failures) {
          owner.controller.signal.throwIfAborted();
          reportReviewReactionLottiePrewarmFailure(failure.error, failure.variant);
        }
      })
      .catch((error: unknown): void => {
        if (owner.controller.signal.aborted) {
          return;
        }
        reportReviewReactionLottiePrewarmFailure(error, null);
      });

    return () => {
      this.stopAndClearWork(
        owner,
        new DOMException("Review reaction Lottie prewarm was stopped", "AbortError"),
      );
    };
  }

  reserveRender(eventId: string, variant: ReviewReactionLottieVariant): boolean {
    const signal = this.getWorkSignal();
    if (signal.aborted) {
      return false;
    }

    if (this.reservedRenderByEventId.has(eventId)) {
      throw new Error(`Review reaction Lottie render reservation already exists for event ${eventId}.`);
    }

    const preparedRender = this.preparedRenderByVariant[variant];
    if (preparedRender === null) {
      return false;
    }

    this.preparedRenderByVariant = {
      ...this.preparedRenderByVariant,
      [variant]: null,
    };
    this.reservedRenderByEventId.set(eventId, preparedRender);
    this.startVariantPrewarm(variant);
    return true;
  }

  mountReservedRender(
    eventId: string,
    variant: ReviewReactionLottieVariant,
    container: HTMLDivElement,
  ): ReviewReactionLottieMountedRender {
    this.getWorkSignal().throwIfAborted();
    const preparedRender = this.reservedRenderByEventId.get(eventId);
    if (preparedRender === undefined) {
      throw new Error(`Review reaction Lottie render reservation is missing for event ${eventId} variant ${variant}.`);
    }
    if (preparedRender.variant !== variant) {
      throw new Error(
        `Review reaction Lottie render reservation for event ${eventId} expected variant ${variant}, `
          + `received ${preparedRender.variant}.`,
      );
    }

    container.appendChild(preparedRender.container);
    this.mountedRenderEventIds.add(eventId);
    return {
      animationItem: preparedRender.animationItem,
    };
  }

  unmountReservedRender(eventId: string): void {
    const preparedRender = this.reservedRenderByEventId.get(eventId);
    if (preparedRender === undefined) {
      return;
    }

    this.mountedRenderEventIds.delete(eventId);
    if (this.releaseRequestedEventIds.has(eventId)) {
      this.releaseRequestedEventIds.delete(eventId);
      this.reservedRenderByEventId.delete(eventId);
      this.destroyPreparedRender(preparedRender);
      return;
    }

    this.moveRenderToOffscreenRoot(preparedRender);
  }

  releaseRender(eventId: string): void {
    const preparedRender = this.reservedRenderByEventId.get(eventId);
    if (preparedRender === undefined) {
      this.mountedRenderEventIds.delete(eventId);
      this.releaseRequestedEventIds.delete(eventId);
      return;
    }

    if (this.mountedRenderEventIds.has(eventId)) {
      this.releaseRequestedEventIds.add(eventId);
      return;
    }

    this.reservedRenderByEventId.delete(eventId);
    this.releaseRequestedEventIds.delete(eventId);
    this.destroyPreparedRender(preparedRender);
  }

  private clearState(): void {
    this.stateGeneration += 1;
    this.destroyPreparedRenders(this.preparedRenderByVariant);
    const mountedRenderByEventId = new Map<string, ReviewReactionLottiePreparedRender>();
    for (const [eventId, preparedRender] of this.reservedRenderByEventId.entries()) {
      if (this.mountedRenderEventIds.has(eventId)) {
        mountedRenderByEventId.set(eventId, preparedRender);
      } else {
        this.destroyPreparedRender(preparedRender);
      }
    }
    this.offscreenRoot?.remove();

    this.playerPromise = null;
    this.playerReady = false;
    this.animationDataByVariant = makeEmptyReviewReactionLottieVariantRecord<object>();
    this.animationPromiseByVariant = makeEmptyReviewReactionLottieVariantRecord<Promise<object>>();
    this.preparedRenderByVariant = makeEmptyReviewReactionLottieVariantRecord<ReviewReactionLottiePreparedRender>();
    this.preparedRenderPromiseByVariant = (
      makeEmptyReviewReactionLottieVariantRecord<Promise<ReviewReactionLottiePreparedRender>>()
    );
    this.failureByVariant = makeEmptyReviewReactionLottieVariantRecord<unknown>();
    this.reservedRenderByEventId = mountedRenderByEventId;
    this.mountedRenderEventIds = new Set<string>(mountedRenderByEventId.keys());
    this.releaseRequestedEventIds = new Set<string>(mountedRenderByEventId.keys());
    this.offscreenRoot = null;
  }

  private detachWorkOwner(owner: ReviewReactionLottieWorkOwner, reason: unknown): boolean {
    if (this.workOwner !== owner) {
      return false;
    }

    owner.removeRecoveryAbortListener();
    owner.controller.abort(reason);
    this.workOwner = null;
    this.stateGeneration += 1;
    if (this.playerReady === false) {
      this.playerPromise = null;
    }
    this.animationPromiseByVariant = makeEmptyReviewReactionLottieVariantRecord<Promise<object>>();
    this.preparedRenderPromiseByVariant = (
      makeEmptyReviewReactionLottieVariantRecord<Promise<ReviewReactionLottiePreparedRender>>()
    );
    return true;
  }

  private stopAndClearWork(owner: ReviewReactionLottieWorkOwner, reason: unknown): void {
    if (this.detachWorkOwner(owner, reason) === false) {
      return;
    }

    this.clearState();
  }

  private createWorkOwner(recoverySignal: AbortSignal): ReviewReactionLottieWorkOwner {
    if (this.workOwner !== null) {
      this.stopAndClearWork(
        this.workOwner,
        new DOMException("Review reaction Lottie prewarm was replaced", "AbortError"),
      );
    }

    const controller = new AbortController();
    let owner: ReviewReactionLottieWorkOwner | null = null;
    const handleRecoveryAbort = (): void => {
      if (owner === null) {
        return;
      }
      this.stopAndClearWork(owner, recoverySignal.reason);
    };
    recoverySignal.addEventListener("abort", handleRecoveryAbort, { once: true });
    owner = {
      controller,
      removeRecoveryAbortListener: () => {
        recoverySignal.removeEventListener("abort", handleRecoveryAbort);
      },
    };
    this.workOwner = owner;
    if (recoverySignal.aborted) {
      handleRecoveryAbort();
    }
    return owner;
  }

  private getWorkSignal(): AbortSignal {
    return this.workOwner?.controller.signal ?? new AbortController().signal;
  }

  private destroyPreparedRenders(preparedRenderByVariant: ReviewReactionLottiePreparedRenderByVariant): void {
    for (const preparedRender of Object.values(preparedRenderByVariant)) {
      if (preparedRender !== null) {
        this.destroyPreparedRender(preparedRender);
      }
    }
  }

  private destroyPreparedRender(preparedRender: ReviewReactionLottiePreparedRender): void {
    preparedRender.animationItem.destroy();
    preparedRender.container.remove();
  }

  private loadPlayer(signal: AbortSignal): Promise<LottiePlayer> {
    signal.throwIfAborted();
    if (this.playerPromise !== null) {
      return this.playerPromise;
    }

    const generation = this.stateGeneration;
    this.playerPromise = import("lottie-web/build/player/lottie_light")
      .then((lottieModule: ReviewReactionLottiePlayerModule): LottiePlayer => {
        signal.throwIfAborted();
        if (generation === this.stateGeneration) {
          this.playerReady = true;
        }
        return lottieModule.default;
      })
      .catch((error: unknown): never => {
        signal.throwIfAborted();
        if (generation === this.stateGeneration) {
          this.playerReady = false;
          this.playerPromise = null;
        }
        throw error;
      });

    return this.playerPromise;
  }

  private async fetchAnimationData(
    variant: ReviewReactionLottieVariant,
    signal: AbortSignal,
  ): Promise<object> {
    signal.throwIfAborted();
    const url = reviewReactionLottieAnimationUrl(variant);
    let response: Response;
    try {
      response = await fetch(url, { signal });
      signal.throwIfAborted();
    } catch (error: unknown) {
      signal.throwIfAborted();
      throw new Error(
        `Failed to fetch review reaction Lottie animation JSON for variant ${variant} from ${url}.`,
        { cause: error },
      );
    }

    if (!response.ok) {
      signal.throwIfAborted();
      const responseBody = await response.text();
      signal.throwIfAborted();
      throw new Error(
        `Failed to fetch review reaction Lottie animation JSON for variant ${variant} from ${url}. `
          + `Received status ${response.status} ${response.statusText}. Response body: ${responseBody}`,
      );
    }

    let animationData: unknown;
    try {
      signal.throwIfAborted();
      animationData = await response.json();
      signal.throwIfAborted();
    } catch (error: unknown) {
      signal.throwIfAborted();
      throw new Error(
        `Failed to parse review reaction Lottie animation JSON for variant ${variant} from ${url}.`,
        { cause: error },
      );
    }

    if (!isReviewReactionLottieAnimationData(animationData)) {
      throw new TypeError(
        `Review reaction Lottie animation JSON for variant ${variant} from ${url} must parse to an object.`,
      );
    }

    return animationData;
  }

  private loadAnimationData(
    variant: ReviewReactionLottieVariant,
    signal: AbortSignal,
  ): Promise<object> {
    signal.throwIfAborted();
    const cachedAnimationData = this.animationDataByVariant[variant];
    if (cachedAnimationData !== null) {
      return Promise.resolve(cachedAnimationData);
    }

    const cachedAnimationPromise = this.animationPromiseByVariant[variant];
    if (cachedAnimationPromise !== null) {
      return cachedAnimationPromise;
    }

    const generation = this.stateGeneration;
    const animationDataPromise = this.fetchAnimationData(variant, signal)
      .then((animationData: object): object => {
        signal.throwIfAborted();
        if (generation === this.stateGeneration) {
          this.animationDataByVariant = {
            ...this.animationDataByVariant,
            [variant]: animationData,
          };
          this.animationPromiseByVariant = {
            ...this.animationPromiseByVariant,
            [variant]: null,
          };
        }
        return animationData;
      })
      .catch((error: unknown): never => {
        signal.throwIfAborted();
        if (generation === this.stateGeneration) {
          this.animationDataByVariant = {
            ...this.animationDataByVariant,
            [variant]: null,
          };
          this.animationPromiseByVariant = {
            ...this.animationPromiseByVariant,
            [variant]: null,
          };
        }
        throw error;
      });

    this.animationPromiseByVariant = {
      ...this.animationPromiseByVariant,
      [variant]: animationDataPromise,
    };

    return animationDataPromise;
  }

  private requireDocumentBody(signal: AbortSignal): HTMLElement {
    signal.throwIfAborted();
    if (typeof document === "undefined" || document.body === null) {
      throw new Error("Review reaction Lottie prewarm requires a mounted document body.");
    }

    return document.body;
  }

  private makeOffscreenRoot(signal: AbortSignal): HTMLDivElement {
    signal.throwIfAborted();
    const existingRoot = this.offscreenRoot;
    if (existingRoot !== null && existingRoot.isConnected) {
      return existingRoot;
    }

    const body = this.requireDocumentBody(signal);
    signal.throwIfAborted();
    const root = document.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("data-review-reaction-lottie-prewarm-root", "true");
    root.style.position = "absolute";
    root.style.width = "1px";
    root.style.height = "1px";
    root.style.overflow = "hidden";
    root.style.left = "-10000px";
    root.style.top = "-10000px";
    root.style.opacity = "0";
    root.style.pointerEvents = "none";
    signal.throwIfAborted();
    body.appendChild(root);
    this.offscreenRoot = root;
    return root;
  }

  private makeOffscreenContainer(signal: AbortSignal): HTMLDivElement {
    signal.throwIfAborted();
    const root = this.makeOffscreenRoot(signal);
    signal.throwIfAborted();
    const container = document.createElement("div");
    signal.throwIfAborted();
    root.appendChild(container);
    return container;
  }

  private moveRenderToOffscreenRoot(preparedRender: ReviewReactionLottiePreparedRender): void {
    this.makeOffscreenRoot(this.getWorkSignal()).appendChild(preparedRender.container);
  }

  private waitForPreparedRender(
    animationItem: AnimationItem,
    variant: ReviewReactionLottieVariant,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    if (animationItem.isLoaded) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let removeDomLoadedListener: (() => void) | null = null;
      let removeDataFailedListener: (() => void) | null = null;
      let removeErrorListener: (() => void) | null = null;
      let hasSettled = false;

      const removeListeners = (): void => {
        removeDomLoadedListener?.();
        removeDataFailedListener?.();
        removeErrorListener?.();
        signal.removeEventListener("abort", markRenderAborted);
        removeDomLoadedListener = null;
        removeDataFailedListener = null;
        removeErrorListener = null;
      };

      const markRenderReady = (): void => {
        if (hasSettled) {
          return;
        }

        hasSettled = true;
        removeListeners();
        resolve();
      };

      const markRenderFailed = (eventName: "data_failed" | "error"): void => {
        if (hasSettled) {
          return;
        }

        hasSettled = true;
        removeListeners();
        reject(makeReviewReactionLottieRenderEventError(eventName, variant));
      };

      const markRenderAborted = (): void => {
        if (hasSettled) {
          return;
        }

        hasSettled = true;
        removeListeners();
        reject(signal.reason);
      };

      signal.addEventListener("abort", markRenderAborted, { once: true });
      removeDomLoadedListener = animationItem.addEventListener("DOMLoaded", markRenderReady);
      removeDataFailedListener = animationItem.addEventListener("data_failed", () => {
        markRenderFailed("data_failed");
      });
      removeErrorListener = animationItem.addEventListener("error", () => {
        markRenderFailed("error");
      });
      if (animationItem.isLoaded) {
        markRenderReady();
      } else if (signal.aborted) {
        markRenderAborted();
      }
    });
  }

  private async makePreparedRender(
    variant: ReviewReactionLottieVariant,
    signal: AbortSignal,
  ): Promise<ReviewReactionLottiePreparedRender> {
    signal.throwIfAborted();
    const [player, animationData] = await Promise.all([
      this.loadPlayer(signal),
      this.loadAnimationData(variant, signal),
    ]);
    signal.throwIfAborted();
    const container = this.makeOffscreenContainer(signal);
    let animationItem: AnimationItem;

    try {
      signal.throwIfAborted();
      animationItem = player.loadAnimation({
        container,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData,
      });
    } catch (error: unknown) {
      container.remove();
      throw new Error(
        `Failed to create review reaction Lottie render instance for variant ${variant}.`,
        { cause: error },
      );
    }

    try {
      await this.waitForPreparedRender(animationItem, variant, signal);
      signal.throwIfAborted();
    } catch (error: unknown) {
      animationItem.destroy();
      container.remove();
      throw new Error(
        `Failed to prepare review reaction Lottie render instance for variant ${variant}.`,
        { cause: error },
      );
    }

    return {
      animationData,
      animationItem,
      container,
      player,
      variant,
    };
  }

  private prewarmVariant(
    variant: ReviewReactionLottieVariant,
    signal: AbortSignal,
  ): Promise<ReviewReactionLottiePreparedRender> {
    signal.throwIfAborted();
    const preparedRender = this.preparedRenderByVariant[variant];
    if (preparedRender !== null) {
      return Promise.resolve(preparedRender);
    }

    const preparedRenderPromise = this.preparedRenderPromiseByVariant[variant];
    if (preparedRenderPromise !== null) {
      return preparedRenderPromise;
    }

    const generation = this.stateGeneration;
    const nextPreparedRenderPromise = this.makePreparedRender(variant, signal)
      .then((nextPreparedRender: ReviewReactionLottiePreparedRender): ReviewReactionLottiePreparedRender => {
        signal.throwIfAborted();
        if (generation !== this.stateGeneration) {
          this.destroyPreparedRender(nextPreparedRender);
          return nextPreparedRender;
        }

        this.preparedRenderByVariant = {
          ...this.preparedRenderByVariant,
          [variant]: nextPreparedRender,
        };
        this.preparedRenderPromiseByVariant = {
          ...this.preparedRenderPromiseByVariant,
          [variant]: null,
        };
        this.failureByVariant = {
          ...this.failureByVariant,
          [variant]: null,
        };
        return nextPreparedRender;
      })
      .catch((error: unknown): never => {
        signal.throwIfAborted();
        if (generation === this.stateGeneration) {
          this.preparedRenderByVariant = {
            ...this.preparedRenderByVariant,
            [variant]: null,
          };
          this.preparedRenderPromiseByVariant = {
            ...this.preparedRenderPromiseByVariant,
            [variant]: null,
          };
          this.failureByVariant = {
            ...this.failureByVariant,
            [variant]: error,
          };
        }
        throw error;
      });

    this.preparedRenderPromiseByVariant = {
      ...this.preparedRenderPromiseByVariant,
      [variant]: nextPreparedRenderPromise,
    };

    return nextPreparedRenderPromise;
  }

  private startVariantPrewarm(variant: ReviewReactionLottieVariant): void {
    const signal = this.getWorkSignal();
    if (signal.aborted) {
      return;
    }

    void this.prewarmVariant(variant, signal).catch((error: unknown) => {
      if (signal.aborted) {
        return;
      }
      reportReviewReactionLottiePrewarmFailure(error, variant);
    });
  }
}
