import Foundation

private let reviewCardsStringsTableName: String = "ReviewCards"
private let onboardingDemoCardTag: String = "demo"
private let onboardingDemoCardProductName: String = "**Flashcards Open Source App**"

extension LocalDatabase {
    /**
     Seeds the onboarding demo card without ever failing the caller.

     The card is an onboarding decoration, so a seeding failure must never take
     down whatever the caller is doing — on first launch that is the decision of
     whether the app has a local database at all. The failure is reported to
     observability instead of being swallowed, and the user simply starts with
     an empty workspace.
     */
    func seedOnboardingDemoCardReportingFailure() {
        do {
            try self.seedOnboardingDemoCardIfNeeded()
        } catch {
            FlashcardsObservability.captureSilentFailure(
                error: error,
                scope: IOSObservationScope(
                    feature: .localData,
                    userId: nil,
                    workspaceId: self.core.createdDefaultWorkspaceId,
                    requestId: nil,
                    clientRequestId: nil,
                    sessionId: nil,
                    runId: nil,
                    cloudState: nil,
                    configurationMode: nil
                ),
                action: "demo_card_seed",
                stage: "startup",
                statusCode: nil,
                backendCode: nil,
                requestId: nil
            )
        }
    }

    /**
     Creates the onboarding demo card at the moment this device first creates
     its local default workspace row, offline and before any network call.

     The card is written through the normal card mutation path, so it is an
     ordinary `demo`-tagged card everywhere afterwards: review, cards list,
     filters, tags, sync and export treat it like any other card, and deleting
     it is permanent.

     Seeding is skipped unless the bootstrapper just created the workspace, and
     skipped again when that workspace already holds any card, so an existing
     install updated to this build never gains a card.
     */
    func seedOnboardingDemoCardIfNeeded() throws {
        guard let workspaceId = self.core.createdDefaultWorkspaceId else {
            return
        }

        let existingCardCount = try self.core.scalarInt(
            sql: "SELECT COUNT(*) FROM cards WHERE workspace_id = ?",
            values: [.text(workspaceId)]
        )
        guard existingCardCount == 0 else {
            return
        }

        _ = try self.createCards(
            workspaceId: workspaceId,
            inputs: [
                CardEditorInput(
                    frontText: onboardingDemoCardFrontText(),
                    backText: onboardingDemoCardBackText(),
                    tags: [onboardingDemoCardTag]
                )
            ]
        )
    }
}

private func onboardingDemoCardFrontText() -> String {
    String(
        localized: "demo_card_front",
        defaultValue: "What is the best application for studying?",
        table: reviewCardsStringsTableName,
        comment: "Front of the onboarding demo flashcard"
    )
}

/**
 Builds the demo card answer from the localized paragraphs.

 The rating labels come from the same `Again` and `Hard` entries the review
 buttons use, so the card always names the buttons the reader can see. The
 product name is never localized. The assembled text carries exactly two kinds
 of Markdown, both added here rather than in the localized values: bold around
 the product name and inline code around each rating label.

 The backticks are load-bearing. `classifyReviewContentPresentation` switches a
 card side to Markdown only on a backtick or a block-level cue, and inline
 emphasis alone never switches the mode (`docs/review-markdown-rendering.md`).
 Without the backticks this multi-paragraph text classifies as `paragraphPlain`,
 which renders verbatim, so the reader would see the literal `**` around the
 product name. Whoever removes the backticks must also remove the bold.
 */
private func onboardingDemoCardBackText() -> String {
    let againRatingLabel = "`\(String(localized: "Again", table: reviewCardsStringsTableName))`"
    let hardRatingLabel = "`\(String(localized: "Hard", table: reviewCardsStringsTableName))`"
    let paragraphs: [String] = [
        String(
            format: String(
                localized: "demo_card_back_1",
                defaultValue: "%@ — the app you are looking at right now.",
                table: reviewCardsStringsTableName,
                comment: "Paragraph on the back of the onboarding demo flashcard. %@ is the never-localized product name, already wrapped in Markdown bold."
            ),
            onboardingDemoCardProductName
        ),
        String(
            localized: "demo_card_back_2",
            defaultValue: "Everything here is a flashcard: a question on the front, the answer on the back. You can write cards yourself, or just give the built-in AI chat a topic and it will create a set of cards for you.",
            table: reviewCardsStringsTableName,
            comment: "Paragraph on the back of the onboarding demo flashcard"
        ),
        String(
            localized: "demo_card_back_3",
            defaultValue: "When you review, you try to recall the answer, then rate how it went. Every card schedules itself from there: what you know well comes back in weeks or months, what you keep forgetting comes back today or tomorrow.",
            table: reviewCardsStringsTableName,
            comment: "Paragraph on the back of the onboarding demo flashcard"
        ),
        String(
            format: String(
                localized: "demo_card_back_4",
                defaultValue: "Rate honestly, this is what makes it work. If you did not know the answer, choose %1$@ — including when you had to peek. %2$@ is only for answers you knew but struggled to recall.",
                table: reviewCardsStringsTableName,
                comment: "Paragraph on the back of the onboarding demo flashcard. %1$@ is the Again rating label and %2$@ the Hard rating label; both arrive already wrapped in Markdown inline code, so do not add quotation marks around them."
            ),
            againRatingLabel,
            hardRatingLabel
        ),
        String(
            format: String(
                localized: "demo_card_back_5",
                defaultValue: "Try it right now: rate this card %@, and it will come back in about a minute — so this answer sticks.",
                table: reviewCardsStringsTableName,
                comment: "Paragraph on the back of the onboarding demo flashcard. %@ is the Again rating label, already wrapped in Markdown inline code, so do not add quotation marks around it."
            ),
            againRatingLabel
        )
    ]

    return paragraphs.joined(separator: "\n\n")
}
