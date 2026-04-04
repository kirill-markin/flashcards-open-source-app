import AVFAudio
import SwiftUI

private let reviewBottomBarHorizontalPadding: CGFloat = 20
private let reviewBottomBarTopPadding: CGFloat = 8
private let reviewBottomBarBottomPadding: CGFloat = 8
private let reviewBottomBarButtonSpacing: CGFloat = 10
private let reviewAnswerButtonMinHeight: CGFloat = 40
private let showAnswerButtonMinHeight: CGFloat = 56
let emptyBackTextPlaceholder: String = "No back text"
private let reviewQueuePreviewPageSize: Int = 50

struct ReviewView: View {
    @Environment(FlashcardsStore.self) var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @StateObject private var reviewSpeechController = ReviewSpeechController()
    @State var isAnswerVisible: Bool = false
    @State var preparedRevealState: PreparedReviewRevealState? = nil
    // Keep the next review card warm so the next front can appear immediately after rating.
    @State var preparedNextRevealState: PreparedReviewRevealState? = nil
    @State var isQueuePreviewPresented: Bool = false
    @State var isEditorPresented: Bool = false
    @State var editingCardId: String? = nil
    @State var cardFormState: CardFormState = CardFormState(
        frontText: "",
        backText: "",
        tags: [],
        effortLevel: .fast
    )
    @State var screenErrorMessage: String = ""
    @State var reviewTagSummaries: [WorkspaceTagSummary] = []
    @State var reviewDeckSummaries: [DeckSummary] = []
    @State var totalCardsCount: Int = 0

    private var availableTagSuggestions: [TagSuggestion] {
        self.reviewTagSummaries.map { tagSummary in
            TagSuggestion(
                tag: tagSummary.tag,
                countState: .ready(cardsCount: tagSummary.cardsCount)
            )
        }
    }

    private var selectedReviewFilterTitle: String {
        switch store.selectedReviewFilter {
        case .allCards:
            return allCardsDeckLabel
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? allCardsDeckLabel
        case .tag(let tag):
            return tag
        }
    }

    private func reviewFilterMenuItemLabel(reviewFilter: ReviewFilter) -> String {
        switch reviewFilter {
        case .allCards:
            return allCardsDeckLabel
        case .deck(let deckId):
            return self.reviewDeckSummaries.first(where: { deckSummary in
                deckSummary.deckId == deckId
            })?.name ?? allCardsDeckLabel
        case .tag(let tag):
            guard let tagSummary = reviewTagSummaries.first(where: { summary in
                summary.tag == tag
            }) else {
                return tag
            }

            return "\(tagSummary.tag) (\(tagSummary.cardsCount))"
        }
    }

    private var currentCard: Card? {
        currentReviewCard(reviewQueue: store.effectiveReviewQueue)
    }

    private var cachedPreparedCurrentRevealState: PreparedReviewRevealState? {
        guard let currentCard else {
            return nil
        }

        return self.cachedPreparedRevealState(card: currentCard)
    }

    private var preparedRevealStatesTaskId: String {
        makePreparedReviewRevealStatesTaskId(
            reviewQueue: store.effectiveReviewQueue,
            schedulerSettings: store.schedulerSettings
        )
    }

    private var shouldShowReviewLoader: Bool {
        if store.isReviewHeadLoading {
            return true
        }
        if let currentCard {
            return self.cachedPreparedRevealState(card: currentCard) == nil
        }

        return store.isReviewQueueChunkLoading
    }

    var body: some View {
        ZStack {
            Group {
                if self.shouldShowReviewLoader {
                    reviewLoadingView
                } else if let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
                    activeCardView(card: currentCard, preparedRevealState: preparedRevealState)
                } else {
                    emptyStateView
                }
            }
        }
        .accessibilityIdentifier(UITestIdentifier.reviewScreen)
        .navigationTitle("Review")
        .onChange(of: currentCard?.cardId) { _, _ in
            isAnswerVisible = false
            self.reviewSpeechController.stopSpeech()
        }
        .onDisappear {
            self.reviewSpeechController.stopSpeech()
        }
        .task(id: preparedRevealStatesTaskId) {
            await self.refreshPreparedRevealStates(reviewQueue: store.effectiveReviewQueue)
        }
        .task(id: store.localReadVersion) {
            await self.reloadReviewMetadata()
        }
        .safeAreaBar(edge: .bottom, spacing: 0) {
            reviewBottomAccessory
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                reviewFilterMenu
            }

            ToolbarItem(placement: .topBarTrailing) {
                if store.isReviewCountsLoading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Loading review queue")
                } else {
                    Button {
                        self.isQueuePreviewPresented = true
                    } label: {
                        Text("\(store.displayedReviewDueCount) / \(store.reviewTotalCount)")
                            .font(.subheadline.monospacedDigit())
                            .padding(.horizontal, 6)
                            .foregroundStyle(.secondary)
                    }
                    .disabled(store.reviewTotalCount == 0)
                    .accessibilityLabel("Review queue \(store.displayedReviewDueCount) active of \(store.reviewTotalCount) total")
                }
            }
        }
        .fullScreenCover(isPresented: self.$isQueuePreviewPresented) {
            NavigationStack {
                ReviewQueuePreviewScreen(
                    title: self.selectedReviewFilterTitle,
                    activeCount: store.displayedReviewDueCount,
                    currentCardId: currentCard?.cardId,
                    hiddenCardIds: store.pendingReviewCardIds,
                    loadPage: { offset in
                        try await store.loadReviewTimelinePage(
                            limit: reviewQueuePreviewPageSize,
                            offset: offset
                        )
                    }
                )
            }
        }
        .sheet(isPresented: self.$isEditorPresented) {
            NavigationStack {
                CardEditorScreen(
                    title: "Edit card",
                    isEditing: true,
                    errorMessage: screenErrorMessage,
                    availableTagSuggestions: self.availableTagSuggestions,
                    formState: self.$cardFormState,
                    onCancel: {
                        self.isEditorPresented = false
                    },
                    onSave: {
                        self.saveEditedCard()
                    },
                    onDelete: {
                        self.deleteEditingCard()
                    }
                )
            }
        }
        .alert(
            "Review wasn't saved",
            isPresented: Binding(
                get: {
                    store.reviewSubmissionFailure != nil
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewSubmissionFailure()
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                store.dismissReviewSubmissionFailure()
            }
        } message: {
            Text(store.reviewSubmissionFailure?.message ?? "")
        }
        .alert(
            "Stay on top of your cards",
            isPresented: Binding(
                get: {
                    store.isReviewNotificationPrePromptPresented
                },
                set: { isPresented in
                    if isPresented == false {
                        store.dismissReviewNotificationPrePrompt(markDismissed: false)
                    }
                }
            )
        ) {
            Button("Not now", role: .cancel) {
                store.dismissReviewNotificationPrePrompt(markDismissed: true)
            }
            Button("Continue") {
                store.continueReviewNotificationPrePrompt()
            }
        } message: {
            Text("Flashcards Open Source App can send study reminders with a card from your review queue. These notifications contain study cards only and never marketing messages.")
        }
    }

    private var reviewFilterMenu: some View {
        Menu {
            Picker(
                "",
                selection: Binding(
                    get: {
                        store.selectedReviewFilter
                    },
                    set: { nextReviewFilter in
                        store.selectReviewFilter(reviewFilter: nextReviewFilter)
                    }
                )
            ) {
                ForEach([ReviewFilter.allCards] + self.reviewDeckSummaries.map { deckSummary in
                    .deck(deckId: deckSummary.deckId)
                }) { reviewFilter in
                    Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                        .tag(reviewFilter)
                }
            }

            Button {
                navigation.openSettings(destination: .workspaceDecks)
            } label: {
                Label("Edit decks", systemImage: "square.stack.3d.up")
            }

            if reviewTagSummaries.isEmpty == false {
                Divider()

                Picker(
                    "",
                    selection: Binding(
                        get: {
                            store.selectedReviewFilter
                        },
                        set: { nextReviewFilter in
                            store.selectReviewFilter(reviewFilter: nextReviewFilter)
                        }
                    )
                ) {
                    ForEach(reviewTagSummaries, id: \.tag) { tagSummary in
                        let reviewFilter = ReviewFilter.tag(tag: tagSummary.tag)

                        Text(reviewFilterMenuItemLabel(reviewFilter: reviewFilter))
                            .tag(reviewFilter)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(self.selectedReviewFilterTitle)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
            }
        }
    }

    private var reviewLoadingView: some View {
        VStack {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func activeCardView(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        ScrollView {
            ReadableContentLayout(
                maxWidth: flashcardsReadableContentMaxWidth,
                horizontalPadding: 20
            ) {
                activeCardContentView(card: card, preparedRevealState: preparedRevealState)
                    .padding(.vertical, 20)
            }
        }
    }

    private func activeCardContentView(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        return VStack(alignment: .leading, spacing: 20) {
            if screenErrorMessage.isEmpty == false {
                Text(screenErrorMessage)
                    .foregroundStyle(.red)
            }

            HStack(alignment: .top, spacing: 12) {
                HStack(spacing: 12) {
                    Label(card.effortLevel.title, systemImage: "timer")
                    Label(card.tags.isEmpty ? "No tags" : formatTags(tags: card.tags), systemImage: "tag")
                }

                Spacer(minLength: 12)

                Button {
                    self.beginEditing(card: card)
                } label: {
                    Image(systemName: "pencil.circle.fill")
                        .font(.title3)
                }
                .accessibilityLabel("Edit card")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            ReviewCardSideView(
                label: "Front",
                content: preparedRevealState.frontContent,
                isSpeechPlaying: self.reviewSpeechController.activeSide == .front,
                onToggleSpeech: {
                    self.toggleSpeech(side: .front, sourceText: card.frontText)
                },
                showsSpeechButton: preparedRevealState.frontSpeakableText.isEmpty == false,
                surfaceStyle: .front
            )

            if isAnswerVisible {
                ReviewCardSideView(
                    label: "Back",
                    content: preparedRevealState.backContent,
                    isSpeechPlaying: self.reviewSpeechController.activeSide == .back,
                    onToggleSpeech: {
                        self.toggleSpeech(side: .back, sourceText: card.backText)
                    },
                    showsSpeechButton: preparedRevealState.backSpeakableText.isEmpty == false,
                    surfaceStyle: .back
                )
            }

            HStack(spacing: 12) {
                Label("Due \(formatOptionalIsoTimestampForDisplay(value: card.dueAt))", systemImage: "clock")
                Label("Reps \(card.reps)", systemImage: "arrow.clockwise")
                Label("Lapses \(card.lapses)", systemImage: "exclamationmark.circle")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let reviewActionErrorMessage = reviewActionErrorMessage(card: card) {
                Text(reviewActionErrorMessage)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private func reviewBottomBar(card: Card, preparedRevealState: PreparedReviewRevealState) -> some View {
        if isAnswerVisible {
            if let options = preparedRevealState.reviewAnswerGridOptions {
                reviewAnswerButtonsGrid(cardId: card.cardId, options: options)
            }
        } else {
            showAnswerButton
        }
    }

    private var reviewBottomAccessory: some View {
        Group {
            if self.shouldShowReviewLoader {
                EmptyView()
            } else if let currentCard, let preparedRevealState = self.cachedPreparedCurrentRevealState {
                reviewBottomBarContainer {
                    reviewBottomBar(card: currentCard, preparedRevealState: preparedRevealState)
                }
            }
        }
    }

    private func reviewBottomBarContainer<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableContentMaxWidth,
            horizontalPadding: reviewBottomBarHorizontalPadding
        ) {
            content()
                .padding(.top, reviewBottomBarTopPadding)
                .padding(.bottom, reviewBottomBarBottomPadding)
        }
    }

    private var showAnswerButton: some View {
        Button {
            isAnswerVisible = true
        } label: {
            Label("Show answer", systemImage: "eye")
                .frame(maxWidth: .infinity)
                .frame(minHeight: showAnswerButtonMinHeight)
        }
        .buttonStyle(.glassProminent)
        .accessibilityIdentifier(UITestIdentifier.reviewShowAnswerButton)
    }

    private func reviewAnswerButtonsGrid(cardId: String, options: ReviewAnswerGridOptions) -> some View {
        HStack(alignment: .top, spacing: reviewBottomBarButtonSpacing) {
            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.again)
                reviewAnswerButton(cardId: cardId, option: options.good)
            }

            VStack(spacing: reviewBottomBarButtonSpacing) {
                reviewAnswerButton(cardId: cardId, option: options.hard)
                reviewAnswerButton(cardId: cardId, option: options.easy)
            }
        }
    }

    private func reviewAnswerButton(cardId: String, option: ReviewAnswerOption) -> some View {
        Button {
            self.submitReview(cardId: cardId, rating: option.rating)
        } label: {
            VStack(alignment: .center, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: option.rating.symbolName)
                        .font(.headline)

                    Text(option.rating.title)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                }

                Text(option.intervalDescription)
                    .font(.caption2)
                    .opacity(0.8)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity, minHeight: reviewAnswerButtonMinHeight, alignment: .center)
        }
        .buttonStyle(.glassProminent)
        .disabled(store.isReviewPending(cardId: cardId))
        .accessibilityIdentifier(reviewAnswerButtonIdentifier(rating: option.rating))
    }

    private func reviewActionErrorMessage(card: Card) -> String? {
        guard isAnswerVisible else {
            return nil
        }

        return self.cachedPreparedRevealState(card: card)?.reviewAnswerOptionsErrorMessage
    }

    private var emptyStateView: some View {
        let shouldShowSwitchToAllCardsAction = store.selectedReviewFilter != .allCards

        return ContentUnavailableView {
            if self.totalCardsCount == 0 {
                Label("No Cards Yet", systemImage: "tray")
            } else {
                Label("Nothing Due", systemImage: "checkmark.circle")
            }
        } description: {
            if self.totalCardsCount == 0 {
                Text("You haven't created any cards yet. Add your first card to start studying.")
            } else {
                Text("You're all caught up for now. Come back later or add more cards.")
            }
        } actions: {
            VStack(spacing: 8) {
                Button {
                    navigation.openCardCreation()
                } label: {
                    Label("Create card", systemImage: "plus")
                        .font(.body)
                        .imageScale(.medium)
                }
                .buttonStyle(.glass)

                Text("or")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    navigation.openAICardCreation()
                } label: {
                    Label("Create with AI", systemImage: "sparkles")
                        .font(.body)
                        .imageScale(.medium)
                }
                .buttonStyle(.glassProminent)

                if shouldShowSwitchToAllCardsAction {
                    Text("or")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        store.selectReviewFilter(reviewFilter: .allCards)
                    } label: {
                        Text("switch to all cards deck")
                    }
                    .buttonStyle(.glass)
                }
            }
        }
    }

    private func toggleSpeech(side: ReviewSpeechSide, sourceText: String) {
        let fallbackLanguageTag = Locale.autoupdatingCurrent.identifier.replacingOccurrences(of: "_", with: "-")
        let errorMessage = self.reviewSpeechController.toggleSpeech(
            side: side,
            sourceText: sourceText,
            fallbackLanguageTag: fallbackLanguageTag
        )

        if let errorMessage {
            self.store.enqueueTransientBanner(
                banner: makeReviewSpeechUnavailableBanner(message: errorMessage)
            )
        }
    }

}

private func reviewAnswerButtonIdentifier(rating: ReviewRating) -> String {
    if rating == .good {
        return UITestIdentifier.reviewRateGoodButton
    }

    return "review.rating.\(rating.rawValue)"
}

#Preview {
    NavigationStack {
        ReviewView()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}

enum ReviewSpeechSide {
    case front
    case back
}

private struct ReviewSpeechLanguageHeuristic {
    let languageTag: String
    let markers: [String]
}

private let reviewSpeechLatinLanguageHeuristics: [ReviewSpeechLanguageHeuristic] = [
    ReviewSpeechLanguageHeuristic(
        languageTag: "es-ES",
        markers: [" el ", " la ", " que ", " de ", " y ", " por ", " para ", " hola ", " gracias ", " cómo "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "fr-FR",
        markers: [" le ", " la ", " les ", " des ", " une ", " bonjour ", " merci ", " avec ", " pour ", " est "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "de-DE",
        markers: [" der ", " die ", " das ", " und ", " nicht ", " danke ", " bitte ", " ist ", " wie ", " ich "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "it-IT",
        markers: [" il ", " lo ", " gli ", " una ", " ciao ", " grazie ", " per ", " non ", " come ", " che "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "pt-PT",
        markers: [" não ", " você ", " obrigado ", " olá ", " para ", " com ", " uma ", " que ", " está "]
    ),
    ReviewSpeechLanguageHeuristic(
        languageTag: "en-US",
        markers: [" the ", " and ", " you ", " are ", " with ", " this ", " that ", " hello ", " thanks ", " what "]
    )
]

@MainActor
final class ReviewSpeechController: NSObject, ObservableObject, @preconcurrency AVSpeechSynthesizerDelegate {
    @Published private(set) var activeSide: ReviewSpeechSide? = nil

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        self.synthesizer.delegate = self
    }

    func toggleSpeech(
        side: ReviewSpeechSide,
        sourceText: String,
        fallbackLanguageTag: String
    ) -> String? {
        let speakableText = makeReviewSpeakableText(text: sourceText)
        if speakableText.isEmpty {
            return nil
        }

        if self.activeSide == side && self.synthesizer.isSpeaking {
            self.stopSpeech()
            return nil
        }

        self.stopSpeech()

        let languageTag = detectReviewSpeechLanguage(
            text: speakableText,
            fallbackLanguageTag: fallbackLanguageTag
        )

        guard let voice = selectReviewSpeechVoice(languageTag: languageTag) else {
            return reviewSpeechUnavailableBannerMessage
        }

        let utterance = AVSpeechUtterance(string: speakableText)
        utterance.voice = voice

        self.activeSide = side
        self.synthesizer.speak(utterance)
        return nil
    }

    func stopSpeech() {
        self.activeSide = nil
        if self.synthesizer.isSpeaking || self.synthesizer.isPaused {
            self.synthesizer.stopSpeaking(at: .immediate)
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.activeSide = nil
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.activeSide = nil
        }
    }
}

private func selectReviewSpeechVoice(languageTag: String) -> AVSpeechSynthesisVoice? {
    let normalizedTag = sanitizeReviewSpeechLanguageTag(languageTag: languageTag).lowercased()
    let primaryLanguage = normalizedTag.split(separator: "-").first.map(String.init) ?? normalizedTag

    if let directVoice = AVSpeechSynthesisVoice(language: normalizedTag) {
        return directVoice
    }

    let availableVoices = AVSpeechSynthesisVoice.speechVoices()

    if let exactVoice = availableVoices.first(where: { voice in
        voice.language.lowercased() == normalizedTag
    }) {
        return exactVoice
    }

    if let prefixVoice = availableVoices.first(where: { voice in
        voice.language.lowercased().hasPrefix("\(primaryLanguage)-")
    }) {
        return prefixVoice
    }

    return availableVoices.first(where: { voice in
        voice.language.lowercased() == primaryLanguage
    })
}

private func detectReviewSpeechLanguage(text: String, fallbackLanguageTag: String) -> String {
    let normalizedText = " \(text.lowercased()) "

    if reviewSpeechContains(pattern: #"[぀-ヿ]"#, text: normalizedText) {
        return "ja-JP"
    }
    if reviewSpeechContains(pattern: #"[가-힯]"#, text: normalizedText) {
        return "ko-KR"
    }
    if reviewSpeechContains(pattern: #"[一-鿿]"#, text: normalizedText) {
        return "zh-CN"
    }
    if reviewSpeechContains(pattern: #"[Ѐ-ӿ]"#, text: normalizedText) {
        return "ru-RU"
    }
    if reviewSpeechContains(pattern: #"[Ͱ-Ͽ]"#, text: normalizedText) {
        return "el-GR"
    }
    if reviewSpeechContains(pattern: #"[֐-׿]"#, text: normalizedText) {
        return "he-IL"
    }
    if reviewSpeechContains(pattern: #"[؀-ۿ]"#, text: normalizedText) {
        return "ar-SA"
    }
    if reviewSpeechContains(pattern: #"[฀-๿]"#, text: normalizedText) {
        return "th-TH"
    }
    if reviewSpeechContains(pattern: #"[ऀ-ॿ]"#, text: normalizedText) {
        return "hi-IN"
    }
    if reviewSpeechContains(pattern: #"[¿¡ñ]"#, text: normalizedText) {
        return "es-ES"
    }
    if reviewSpeechContains(pattern: #"[äöüß]"#, text: normalizedText) {
        return "de-DE"
    }
    if reviewSpeechContains(pattern: #"[ãõ]"#, text: normalizedText) {
        return "pt-PT"
    }
    if reviewSpeechContains(pattern: #"[àèìòù]"#, text: normalizedText) {
        return "it-IT"
    }
    if reviewSpeechContains(pattern: #"[çœæ]"#, text: normalizedText) {
        return "fr-FR"
    }

    var bestLanguageTag: String? = nil
    var bestScore = 0

    for heuristic in reviewSpeechLatinLanguageHeuristics {
        let score = heuristic.markers.reduce(into: 0) { currentScore, marker in
            if normalizedText.contains(marker) {
                currentScore += 1
            }
        }

        if score > bestScore {
            bestScore = score
            bestLanguageTag = heuristic.languageTag
        }
    }

    if let bestLanguageTag, bestScore > 0 {
        return bestLanguageTag
    }

    return sanitizeReviewSpeechLanguageTag(languageTag: fallbackLanguageTag)
}

private func sanitizeReviewSpeechLanguageTag(languageTag: String) -> String {
    let normalizedTag = languageTag.replacingOccurrences(of: "_", with: "-")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return normalizedTag.isEmpty ? "en-US" : normalizedTag
}

private func reviewSpeechContains(pattern: String, text: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
}
