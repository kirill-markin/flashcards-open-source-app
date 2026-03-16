import Foundation

let accountDeletionPendingUserDefaultsKey: String = "account-deletion-pending"
let accountDeletionConfirmationText: String = "delete my account"
let cloudSyncFastPollingIntervalSeconds: TimeInterval = 15
let cloudSyncDefaultPollingIntervalSeconds: TimeInterval = 60
let cloudSyncFastPollingDurationSeconds: TimeInterval = 120

func usesFastCloudSyncPolling(tab: AppTab) -> Bool {
    tab == .review || tab == .cards
}

func isCloudSyncFastPollingActive(selectedTab: AppTab, fastPollingUntil: Date?, now: Date) -> Bool {
    if usesFastCloudSyncPolling(tab: selectedTab) {
        return true
    }

    guard let fastPollingUntil else {
        return false
    }

    return now < fastPollingUntil
}

func currentCloudSyncPollingInterval(selectedTab: AppTab, fastPollingUntil: Date?, now: Date) -> TimeInterval {
    if isCloudSyncFastPollingActive(selectedTab: selectedTab, fastPollingUntil: fastPollingUntil, now: now) {
        return cloudSyncFastPollingIntervalSeconds
    }

    return cloudSyncDefaultPollingIntervalSeconds
}

func extendCloudSyncFastPollingUntil(currentDeadline: Date?, now: Date, duration: TimeInterval) -> Date {
    let nextDeadline = now.addingTimeInterval(duration)

    guard let currentDeadline else {
        return nextDeadline
    }

    return max(currentDeadline, nextDeadline)
}

struct TabSelectionRequest: Equatable, Sendable {
    let id: String
    let tab: AppTab
}

enum AccountDeletionState: Equatable {
    case hidden
    case inProgress
    case failed(message: String)
}

@MainActor
final class FlashcardsStore: ObservableObject {
    @Published var workspace: Workspace?
    @Published var userSettings: UserSettings?
    @Published var schedulerSettings: WorkspaceSchedulerSettings?
    @Published var cloudSettings: CloudSettings?
    @Published var cards: [Card]
    @Published var decks: [Deck]
    @Published var deckItems: [DeckListItem]
    @Published var selectedReviewFilter: ReviewFilter
    @Published var reviewQueue: [Card]
    @Published var reviewCounts: ReviewCounts
    @Published var isReviewHeadLoading: Bool
    @Published var isReviewCountsLoading: Bool
    @Published var isReviewQueueChunkLoading: Bool
    @Published var homeSnapshot: HomeSnapshot
    @Published var globalErrorMessage: String
    @Published var syncStatus: SyncStatus
    @Published var lastSuccessfulCloudSyncAt: String?
    @Published var selectedTab: AppTab
    @Published var cloudSyncFastPollingUntil: Date?
    @Published var tabSelectionRequest: TabSelectionRequest?
    @Published var cardsPresentationRequest: CardsPresentationRequest?
    @Published var aiChatPresentationRequest: AIChatPresentationRequest?
    @Published var settingsPresentationRequest: SettingsNavigationDestination?
    @Published var pendingReviewCardIds: Set<String>
    @Published var reviewSubmissionFailure: ReviewSubmissionFailure?
    @Published var reviewOverlayBanner: ReviewOverlayBanner?
    @Published var accountDeletionState: AccountDeletionState
    @Published var accountDeletionSuccessMessage: String?
    @Published var localReadVersion: Int

    let database: LocalDatabase?
    let dependencies: FlashcardsStoreDependencies
    let userDefaults: UserDefaults
    let encoder: JSONEncoder
    let decoder: JSONDecoder
    var cloudServiceConfigurationValidator: any CloudServiceConfigurationValidating
    var reviewRuntime: ReviewQueueRuntime
    var cloudRuntime: CloudSessionRuntime
    var isAccountDeletionRunning: Bool
    lazy var aiChatStore: AIChatStore = self.makeAIChatStore()

    convenience init() {
        let userDefaults = UserDefaults.standard
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let cloudAuthService = CloudAuthService()
        let credentialStore = CloudCredentialStore()
        let database: LocalDatabase?
        let initialGlobalErrorMessage: String

        do {
            database = try LocalDatabase()
            initialGlobalErrorMessage = ""
        } catch {
            database = nil
            initialGlobalErrorMessage = Flashcards.errorMessage(error: error)
        }

        self.init(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            initialGlobalErrorMessage: initialGlobalErrorMessage
        )
    }

    convenience init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        credentialStore: CloudCredentialStore,
        initialGlobalErrorMessage: String
    ) {
        let reviewSubmissionExecutor: ReviewSubmissionExecuting? = database.map { initializedDatabase in
            ReviewSubmissionExecutor(databaseURL: initializedDatabase.databaseURL)
        }
        self.init(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            credentialStore: credentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: initialGlobalErrorMessage
        )
    }

    init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        credentialStore: CloudCredentialStore,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewTimelinePageLoader: @escaping ReviewTimelinePageLoader,
        initialGlobalErrorMessage: String
    ) {
        let initialSelectedReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: userDefaults,
            decoder: decoder
        )
        let initialReviewPublishedState = ReviewQueueRuntime.makeInitialPublishedState(
            selectedReviewFilter: initialSelectedReviewFilter
        )
        let dependencies = FlashcardsStoreDependencies(
            cloudAuthService: cloudAuthService,
            cloudSyncService: database.map { initializedDatabase in
                CloudSyncService(database: initializedDatabase)
            },
            credentialStore: credentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: reviewHeadLoader,
            reviewCountsLoader: reviewCountsLoader,
            reviewQueueChunkLoader: reviewQueueChunkLoader,
            reviewTimelinePageLoader: reviewTimelinePageLoader
        )

        self.workspace = nil
        self.userSettings = nil
        self.schedulerSettings = nil
        self.cloudSettings = nil
        self.cards = []
        self.decks = []
        self.deckItems = []
        self.selectedReviewFilter = initialReviewPublishedState.selectedReviewFilter
        self.reviewQueue = initialReviewPublishedState.reviewQueue
        self.reviewCounts = initialReviewPublishedState.reviewCounts
        self.isReviewHeadLoading = initialReviewPublishedState.isReviewHeadLoading
        self.isReviewCountsLoading = initialReviewPublishedState.isReviewCountsLoading
        self.isReviewQueueChunkLoading = initialReviewPublishedState.isReviewQueueChunkLoading
        self.homeSnapshot = HomeSnapshot(
            deckCount: 0,
            totalCards: 0,
            dueCount: 0,
            newCount: 0,
            reviewedCount: 0
        )
        self.globalErrorMessage = initialGlobalErrorMessage
        self.syncStatus = .idle
        self.lastSuccessfulCloudSyncAt = nil
        self.selectedTab = .review
        self.cloudSyncFastPollingUntil = nil
        self.tabSelectionRequest = nil
        self.cardsPresentationRequest = nil
        self.aiChatPresentationRequest = nil
        self.settingsPresentationRequest = nil
        self.pendingReviewCardIds = initialReviewPublishedState.pendingReviewCardIds
        self.reviewSubmissionFailure = initialReviewPublishedState.reviewSubmissionFailure
        self.reviewOverlayBanner = nil
        self.accountDeletionState = .hidden
        self.accountDeletionSuccessMessage = nil
        self.localReadVersion = 0
        self.database = database
        self.dependencies = dependencies
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.cloudServiceConfigurationValidator = CloudServiceConfigurationValidator()
        self.reviewRuntime = ReviewQueueRuntime(
            initialSelectedReviewFilter: initialSelectedReviewFilter,
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.cloudRuntime = CloudSessionRuntime(
            cloudAuthService: dependencies.cloudAuthService,
            cloudSyncService: dependencies.cloudSyncService,
            credentialStore: dependencies.credentialStore
        )
        self.isAccountDeletionRunning = false

        if database != nil && initialGlobalErrorMessage.isEmpty {
            do {
                try self.reload()
            } catch {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }

        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            self.accountDeletionState = .inProgress
        }
    }

    func currentCloudSyncPollingInterval(now: Date) -> TimeInterval {
        Flashcards.currentCloudSyncPollingInterval(
            selectedTab: self.selectedTab,
            fastPollingUntil: self.cloudSyncFastPollingUntil,
            now: now
        )
    }

    func extendCloudSyncFastPolling(now: Date) {
        self.cloudSyncFastPollingUntil = extendCloudSyncFastPollingUntil(
            currentDeadline: self.cloudSyncFastPollingUntil,
            now: now,
            duration: cloudSyncFastPollingDurationSeconds
        )
    }
}
