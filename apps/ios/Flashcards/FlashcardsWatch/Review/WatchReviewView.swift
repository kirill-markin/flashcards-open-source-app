import SwiftUI

private let reviewCardsStringsTableName: String = "ReviewCards"

/// The signed-in screen: one Review session per appearance, so leaving `.ready` drops it with its cards.
struct WatchReviewView: View {
    let session: WatchSessionModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: WatchReviewModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model = self.model {
                    WatchReviewSessionView(model: model)
                } else {
                    ProgressView()
                }
            }
        }
        .onAppear {
            guard self.model == nil else {
                return
            }
            guard let database = self.session.database else {
                preconditionFailure("The watch session is ready only with an open local database")
            }
            let model = WatchReviewModel(
                session: self.session,
                databaseURL: database.databaseURL,
                reviewFilter: self.session.reviewFilter
            )
            model.start()
            self.model = model
        }
        .onDisappear {
            self.model?.stop()
            self.model = nil
        }
        .onChange(of: self.session.reviewFilter) { _, reviewFilter in
            self.model?.selectReviewFilter(reviewFilter: reviewFilter)
        }
        .onChange(of: self.session.lastSuccessfulSyncAt) {
            self.model?.refreshKeepingShownCard()
        }
        .onChange(of: self.scenePhase) { _, newPhase in
            if newPhase == .active {
                self.model?.refreshKeepingShownCard()
            }
        }
    }
}

private struct WatchReviewSessionView: View {
    let model: WatchReviewModel

    var body: some View {
        Group {
            if let card = self.model.presentedCard {
                WatchReviewCardView(model: self.model, card: card)
                    // A new card starts at the top instead of the previous card's scroll position.
                    .id(card.cardId)
            } else if case .failed(let message) = self.model.loadState {
                WatchReviewFailureView(
                    message: message,
                    submissionFailure: self.model.reviewState.reviewSubmissionFailure,
                    onRetry: self.model.retry
                )
            } else if self.model.isQueueExhausted {
                WatchReviewAllDoneView(
                    nextDueAt: self.model.nextDueAt,
                    submissionFailure: self.model.reviewState.reviewSubmissionFailure
                )
            } else {
                VStack(spacing: 8) {
                    WatchReviewSubmissionFailureText(failure: self.model.reviewState.reviewSubmissionFailure)
                        .multilineTextAlignment(.center)
                    ProgressView()
                }
            }
        }
        .navigationTitle(self.model.loadState == .loaded ? String(
            localized: "watch.review.due_count \(self.model.reviewState.reviewCounts.dueCount)",
            table: watchStringsTableName,
            comment: "Apple Watch Review title with the number of cards due now"
        ) : "")
    }
}

private struct WatchReviewCardView: View {
    let model: WatchReviewModel
    let card: Card

    var body: some View {
        let frontText = makeWatchReviewCardSideText(markdown: self.card.frontText)
        let backText = makeWatchReviewCardSideText(markdown: self.card.backText)

        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                WatchReviewSubmissionFailureText(failure: self.model.reviewState.reviewSubmissionFailure)
                WatchReviewCardSideView(sideText: frontText, font: .headline)
                if self.model.isAnswerRevealed {
                    Divider()
                    WatchReviewCardSideView(sideText: backText, font: .body)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaBar(edge: .bottom, spacing: 4) {
            if self.model.isAnswerRevealed {
                WatchReviewRatingButtons(onRate: self.model.rate)
            } else {
                Button {
                    self.model.revealAnswer()
                } label: {
                    Text(String(localized: "Show answer", table: reviewCardsStringsTableName))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .handGestureShortcut(.primaryAction)
            }
        }
    }
}

private struct WatchReviewCardSideView: View {
    let sideText: WatchReviewCardSideText
    let font: Font

    var body: some View {
        if self.sideText.text.isEmpty == false {
            Text(self.sideText.text)
                .font(self.font)
        }
        if self.sideText.hasOmittedContent {
            Label(
                String(
                    localized: "watch.review.open_on_iphone",
                    table: watchStringsTableName,
                    comment: "Apple Watch note under a card side whose image or formula the watch cannot show"
                ),
                systemImage: "iphone"
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}

private struct WatchReviewRatingButtons: View {
    let onRate: (ReviewRating) -> Void

    var body: some View {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            GridRow {
                self.ratingButton(rating: .again)
                self.ratingButton(rating: .hard)
            }
            GridRow {
                self.ratingButton(rating: .good)
                self.ratingButton(rating: .easy)
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    private func ratingButton(rating: ReviewRating) -> some View {
        Button {
            self.onRate(rating)
        } label: {
            Text(localizedReviewRatingTitle(rating: rating))
                .font(.footnote.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity)
        }
    }
}

/// A rating that was not saved; shown in every state, since its card may not come back.
private struct WatchReviewSubmissionFailureText: View {
    let failure: ReviewSubmissionFailure?

    var body: some View {
        if let failure = self.failure {
            Text(failure.message)
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }
}

private struct WatchReviewAllDoneView: View {
    let nextDueAt: Date?
    let submissionFailure: ReviewSubmissionFailure?

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchReviewSubmissionFailureText(failure: self.submissionFailure)
                    .multilineTextAlignment(.center)
                Image(systemName: "checkmark.circle")
                    .font(.title2)
                    .foregroundStyle(.tint)
                Text(String(
                    localized: "watch.review.all_done",
                    table: watchStringsTableName,
                    comment: "Apple Watch Review title when no card is due"
                ))
                .font(.headline)
                if let nextDueAt = self.nextDueAt {
                    Text(String(
                        localized: "watch.review.next_card_due \(nextDueAt.formatted(.relative(presentation: .named)))",
                        table: watchStringsTableName,
                        comment: "Apple Watch note with when the next card is due, for example: Next card in 5 minutes"
                    ))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

private struct WatchReviewFailureView: View {
    let message: String
    let submissionFailure: ReviewSubmissionFailure?
    let onRetry: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                WatchReviewSubmissionFailureText(failure: self.submissionFailure)
                    .multilineTextAlignment(.center)
                Text(self.message)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                Button(String(localized: "Retry", table: reviewCardsStringsTableName), action: self.onRetry)
            }
        }
    }
}
