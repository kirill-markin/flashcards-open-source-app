import Foundation

@MainActor
extension FlashcardsStore {
    var selectedReviewFilterTitle: String {
        reviewFilterTitle(reviewFilter: self.selectedReviewFilter, decks: self.decks, cards: self.cards)
    }

    var reviewTotalCount: Int {
        self.reviewCounts.totalCount
    }

    var displayedReviewDueCount: Int {
        max(
            0,
            self.reviewCounts.dueCount - self.reviewRuntime.pendingReviewCount(
                publishedState: self.currentReviewPublishedState(),
                cards: self.cards,
                decks: self.decks
            )
        )
    }

    var effectiveReviewQueue: [Card] {
        self.reviewRuntime.effectiveReviewQueue(publishedState: self.currentReviewPublishedState())
    }

    func selectTab(tab: AppTab) {
        self.selectedTab = tab
        if usesFastCloudSyncPolling(tab: tab) {
            self.extendCloudSyncFastPolling(now: Date())
        }
    }

    func openReview(reviewFilter: ReviewFilter) {
        self.startReviewLoad(reviewFilter: reviewFilter, now: Date())
        self.requestTabSelection(tab: .review)
    }

    func openCardCreation() {
        self.requestTabSelection(tab: .cards)
        self.cardsPresentationRequest = .createCard
    }

    func openAICardCreation() {
        self.requestTabSelection(tab: .ai)
        self.aiChatPresentationRequest = .createCard
    }

    func openDeckManagement() {
        self.requestTabSelection(tab: .settings)
        self.settingsPresentationRequest = .workspaceDecks
    }

    func clearCardsPresentationRequest() {
        self.cardsPresentationRequest = nil
    }

    func clearAIChatPresentationRequest() {
        self.aiChatPresentationRequest = nil
    }

    func clearSettingsPresentationRequest() {
        self.settingsPresentationRequest = nil
    }

    private func requestTabSelection(tab: AppTab) {
        self.selectedTab = tab
        if usesFastCloudSyncPolling(tab: tab) {
            self.extendCloudSyncFastPolling(now: Date())
        }
        self.tabSelectionRequest = TabSelectionRequest(
            id: UUID().uuidString.lowercased(),
            tab: tab
        )
    }
}
