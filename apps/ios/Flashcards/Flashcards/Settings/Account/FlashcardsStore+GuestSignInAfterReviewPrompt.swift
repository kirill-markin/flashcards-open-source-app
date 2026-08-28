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
    }

    func requestGuestSignInAfterReviewPromptReconciliation() {
        self.guestSignInAfterReviewPromptReconciliationToken = self.guestSignInAfterReviewPromptReconciliationToken &+ 1
    }

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
