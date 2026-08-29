import Foundation

@MainActor
extension FlashcardsStore {
    func reconcileGuestSignInAfterReviewPrompt(
        isModalOrAuthFlowActive: Bool,
        now: Date
    ) {
        guard self.isGuestSignInAfterReviewPromptPresented == false else {
            return
        }
        guard shouldPresentGuestSignInAfterReviewPrompt(
            cloudState: self.cloudSettings?.cloudState,
            reviewedCount: self.homeSnapshot.reviewedCount,
            promptState: self.guestSignInAfterReviewPromptState,
            now: now,
            isModalOrAuthFlowActive: isModalOrAuthFlowActive
        ) else {
            return
        }

        self.markGuestSignInAfterReviewPromptShown(
            reviewedCount: self.homeSnapshot.reviewedCount,
            now: now
        )
        self.isGuestSignInAfterReviewPromptPresented = true
        // The showing and the answer are two facts, and this is the showing. Recording only the
        // answer — which is what the retired `onboarding_step_completed` did — leaves no denominator,
        // so no acceptance rate can ever be computed from it.
        Analytics.trackScreenViewed(.signInAfterReviewPrompt)
    }

    func requestGuestSignInAfterReviewPromptReconciliation() {
        self.guestSignInAfterReviewPromptReconciliationToken = self.guestSignInAfterReviewPromptReconciliationToken &+ 1
    }

    /**
     * The prompt closed without either button having decided anything.
     *
     * It reports no answer on purpose. The alert is UIKit-backed and cannot be closed by the person
     * without pressing a button, so this runs either as SwiftUI's own binding write-back behind the
     * button that already reported its outcome — reporting here too would double-count every answer —
     * or for a programmatic close nobody answered.
     */
    func dismissGuestSignInAfterReviewPrompt() {
        self.isGuestSignInAfterReviewPromptPresented = false
    }

    func acceptGuestSignInAfterReviewPrompt(now: Date) {
        self.updateGuestSignInAfterReviewPromptState(
            state: makeAcceptedGuestSignInAfterReviewPromptState(
                promptState: self.guestSignInAfterReviewPromptState,
                now: now
            )
        )
        self.isGuestSignInAfterReviewPromptPresented = false
        // No surface is restored here: accepting opens the sign-in sheet, which reports `signin` as
        // it begins its attempt. Closing that sheet is what hands the tab underneath back, and it
        // reads the visible tab rather than this prompt's entry point, which stays Review.
        Analytics.track(
            .promptAnswered(prompt: .signInAfterReviewPrompt, outcome: .accepted),
            screen: .signInAfterReviewPrompt
        )
    }

    func snoozeGuestSignInAfterReviewPrompt(reviewedCount: Int, now: Date) {
        self.updateGuestSignInAfterReviewPromptState(
            state: makeSnoozedGuestSignInAfterReviewPromptState(
                promptState: self.guestSignInAfterReviewPromptState,
                reviewedCount: reviewedCount,
                now: now
            )
        )
        self.isGuestSignInAfterReviewPromptPresented = false
        // "Later" is `snoozed` rather than `dismissed`: it holds the prompt back for a week and a
        // further ten reviews, which is a different answer from walking away from it.
        Analytics.track(
            .promptAnswered(prompt: .signInAfterReviewPrompt, outcome: .snoozed),
            screen: .signInAfterReviewPrompt
        )
        Analytics.trackScreenViewedOnDismiss(
            of: .signInAfterReviewPrompt,
            restoring: analyticsSurface(tab: self.currentVisibleTab)
        )
    }

    func clearGuestSignInAfterReviewPromptState() {
        self.guestSignInAfterReviewPromptState = makeDefaultGuestSignInAfterReviewPromptState()
        self.isGuestSignInAfterReviewPromptPresented = false
        self.userDefaults.removeObject(forKey: guestSignInAfterReviewPromptUserDefaultsKey)
    }

    private func markGuestSignInAfterReviewPromptShown(reviewedCount: Int, now: Date) {
        self.updateGuestSignInAfterReviewPromptState(
            state: makeGuestSignInAfterReviewPromptShownState(
                promptState: self.guestSignInAfterReviewPromptState,
                reviewedCount: reviewedCount,
                now: now
            )
        )
    }

    private func updateGuestSignInAfterReviewPromptState(state: GuestSignInAfterReviewPromptState) {
        self.guestSignInAfterReviewPromptState = state

        do {
            let data: Data = try self.encoder.encode(state)
            self.userDefaults.set(data, forKey: guestSignInAfterReviewPromptUserDefaultsKey)
        } catch {
            captureGuestSignInAfterReviewPromptSilentFailure(
                error: error,
                action: "guest_sign_in_after_review_prompt_state_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: guestSignInAfterReviewPromptUserDefaultsKey)
        }
    }
}

func captureGuestSignInAfterReviewPromptSilentFailure(
    error: Error,
    action: String,
    stage: String,
    cloudSettings: CloudSettings?,
    workspaceId: String?,
    configurationMode: CloudServiceConfigurationMode?
) {
    FlashcardsObservability.captureSilentFailure(
        error: error,
        scope: IOSObservationScope(
            feature: .prompts,
            userId: cloudSettings?.linkedUserId,
            workspaceId: workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: cloudSettings?.cloudState,
            configurationMode: configurationMode
        ),
        action: action,
        stage: stage,
        statusCode: nil,
        backendCode: nil,
        requestId: nil
    )
}
