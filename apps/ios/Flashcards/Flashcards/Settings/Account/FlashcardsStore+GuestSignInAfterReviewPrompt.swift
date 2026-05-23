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
            self.userDefaults.removeObject(forKey: guestSignInAfterReviewPromptUserDefaultsKey)
        }
    }
}
