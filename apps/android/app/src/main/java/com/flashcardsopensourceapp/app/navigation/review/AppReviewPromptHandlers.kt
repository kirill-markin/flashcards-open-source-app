package com.flashcardsopensourceapp.app.navigation.review

import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewPaywallTrigger
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptHandler
import com.flashcardsopensourceapp.data.local.review.prompts.ReviewPromptId

/** The app is on the review screen with nothing over it and the review surface idle. */
private fun isReviewSurfaceAvailable(appGraph: AppGraph): Boolean {
    return appGraph.reviewPaywallScheduler.isAppAvailable &&
        !appGraph.reviewPaywallScheduler.isReviewSurfaceBusy &&
        appGraph.premiumPresenter.reason == null &&
        !appGraph.guestSignInAfterReviewPromptController.observeUiState().value.isVisible &&
        !appGraph.feedbackPromptController.observeUiState().value.isVisible
}

/** Whether an after-review prompt may appear now; only the store rating's own request skips the last check. */
internal fun canPresentReviewPrompt(appGraph: AppGraph): Boolean {
    return isReviewSurfaceAvailable(appGraph = appGraph) && !appGraph.reviewPaywallScheduler.isStoreReviewInProgress
}

/** The after-review prompts the app shows over the review screen; the review view model owns the rest. */
internal fun makeAppReviewPromptHandlers(appGraph: AppGraph): Map<ReviewPromptId, ReviewPromptHandler> {
    val canPresent = { canPresentReviewPrompt(appGraph = appGraph) }
    return mapOf(
        ReviewPromptId.PAYWALL_INITIAL to makeReviewPaywallHandler(
            appGraph = appGraph,
            trigger = AnalyticsReviewPaywallTrigger.INITIAL,
            canPresent = canPresent
        ),
        ReviewPromptId.PAYWALL_SECOND to makeReviewPaywallHandler(
            appGraph = appGraph,
            trigger = AnalyticsReviewPaywallTrigger.DAY3,
            canPresent = canPresent
        ),
        ReviewPromptId.PAYWALL_PERIODIC to makeReviewPaywallHandler(
            appGraph = appGraph,
            trigger = AnalyticsReviewPaywallTrigger.WEEKLY,
            canPresent = canPresent
        ),
        ReviewPromptId.RATING_REQUEST to ReviewPromptHandler(
            loadLastShownAtMillis = { appGraph.storeReviewRequestManager.lastRequestedAtMillis() },
            tryShow = { reviewPromptConfigVersion ->
                val activity = appGraph.storeReviewActivityProvider.currentActivity()
                if (activity == null) {
                    false
                } else {
                    appGraph.reviewPaywallScheduler.isStoreReviewInProgress = true
                    try {
                        appGraph.storeReviewRequestManager.requestStoreReviewIfEligible(
                            activity = activity,
                            canPresent = { isReviewSurfaceAvailable(appGraph = appGraph) },
                            reviewPromptConfigVersion = reviewPromptConfigVersion
                        )
                    } finally {
                        appGraph.reviewPaywallScheduler.isStoreReviewInProgress = false
                    }
                }
            }
        ),
        ReviewPromptId.GUEST_SIGN_IN to ReviewPromptHandler(
            loadLastShownAtMillis = { appGraph.guestSignInAfterReviewPromptController.lastShownAtMillis() },
            tryShow = { reviewPromptConfigVersion ->
                appGraph.guestSignInAfterReviewPromptController.tryShowAfterReview(
                    canPresent = canPresent,
                    reviewPromptConfigVersion = reviewPromptConfigVersion
                )
            }
        ),
        ReviewPromptId.AUTOMATIC_FEEDBACK to ReviewPromptHandler(
            loadLastShownAtMillis = { appGraph.feedbackPromptController.lastAutomaticPromptShownAtMillis() },
            tryShow = { _ ->
                appGraph.feedbackPromptController.tryShowAutomaticPrompt(canPresent = canPresent)
            }
        )
    )
}

private fun makeReviewPaywallHandler(
    appGraph: AppGraph,
    trigger: AnalyticsReviewPaywallTrigger,
    canPresent: () -> Boolean
): ReviewPromptHandler {
    return ReviewPromptHandler(
        loadLastShownAtMillis = { appGraph.reviewPaywallScheduler.lastShownAt()?.toEpochMilli() },
        tryShow = { reviewPromptConfigVersion ->
            appGraph.reviewPaywallScheduler.tryShowReviewOffer(
                trigger = trigger,
                reviewPromptConfigVersion = reviewPromptConfigVersion,
                canPresent = canPresent
            )
        }
    )
}
