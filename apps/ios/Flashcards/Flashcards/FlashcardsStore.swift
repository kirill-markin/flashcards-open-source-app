import Foundation
import Observation

let accountDeletionPendingUserDefaultsKey: String = "account-deletion-pending"
let accountDeletionConfirmationText: String = "delete my account"
let cloudSyncFastPollingIntervalSeconds: TimeInterval = 15
let cloudSyncDefaultPollingIntervalSeconds: TimeInterval = 60
let cloudSyncFastPollingDurationSeconds: TimeInterval = 120
let cloudImmediateSyncDebounceIntervalSeconds: TimeInterval = 1

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

enum AccountDeletionState: Equatable {
    case hidden
    case inProgress
    case failed(message: String)
}

@MainActor
@Observable
final class FlashcardsStore {
    var workspace: Workspace?
    var userSettings: UserSettings?
    var schedulerSettings: WorkspaceSchedulerSettings?
    var cloudSettings: CloudSettings?
    var cards: [Card]
    var decks: [Deck]
    var deckItems: [DeckListItem]
    var selectedReviewFilter: ReviewFilter
    var reviewQueue: [Card]
    var presentedReviewCardId: String?
    var reviewCounts: ReviewCounts
    var isReviewHeadLoading: Bool
    var isReviewCountsLoading: Bool
    var isReviewQueueChunkLoading: Bool
    var homeSnapshot: HomeSnapshot
    var globalErrorMessage: String
    var syncStatus: SyncStatus
    var lastSuccessfulCloudSyncAt: String?
    var cloudSyncFastPollingUntil: Date?
    var pendingReviewCardIds: Set<String>
    var reviewSubmissionFailure: ReviewSubmissionFailure?
    /// Session-only buffer used to decide when to show the frequent-"Hard" reminder.
    @ObservationIgnored var reviewHardReminderRecentRatings: [ReviewRating]
    var isReviewHardReminderPresented: Bool
    var currentTransientBanner: TransientBanner?
    var queuedTransientBanners: [TransientBanner]
    var reviewNotificationsSettings: ReviewNotificationsSettings
    var notificationPermissionPromptState: NotificationPermissionPromptState
    var isReviewNotificationPrePromptPresented: Bool
    var accountDeletionState: AccountDeletionState
    var accountDeletionSuccessMessage: String?
    var localReadVersion: Int

    @ObservationIgnored let database: LocalDatabase?
    @ObservationIgnored let dependencies: FlashcardsStoreDependencies
    @ObservationIgnored let userDefaults: UserDefaults
    @ObservationIgnored let encoder: JSONEncoder
    @ObservationIgnored let decoder: JSONDecoder
    @ObservationIgnored var cloudServiceConfigurationValidator: any CloudServiceConfigurationValidating
    @ObservationIgnored var reviewRuntime: ReviewQueueRuntime
    @ObservationIgnored var cloudRuntime: CloudSessionRuntime
    @ObservationIgnored var isAccountDeletionRunning: Bool
    @ObservationIgnored var cachedAIChatStore: AIChatStore?
    @ObservationIgnored var currentVisibleTab: AppTab
    @ObservationIgnored var lastImmediateCloudSyncTriggerAt: Date?
    @ObservationIgnored var activeReviewNotificationsRescheduleTask: Task<Void, Never>?
    @ObservationIgnored var reviewNotificationsRescheduleGeneration: Int
    @ObservationIgnored var reviewHardReminderLastShownAt: Date?

    var aiChatStore: AIChatStore {
        if let cachedAIChatStore {
            return cachedAIChatStore
        }

        let aiChatStore = self.makeAIChatStore()
        self.cachedAIChatStore = aiChatStore
        return aiChatStore
    }

    func shutdownForTests() {
        self.cachedAIChatStore?.shutdownForTests()
        self.reviewRuntime.cancelForAccountDeletion()
        self.cloudRuntime.cancelForAccountDeletion()
    }

    convenience init() {
        let userDefaults = UserDefaults.standard
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let cloudAuthService = CloudAuthService()
        let credentialStore = CloudCredentialStore()
        let guestCloudAuthService = GuestCloudAuthService()
        let guestCredentialStore = GuestCloudCredentialStore(
            bundle: .main,
            userDefaults: userDefaults
        )
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
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
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
        guestCloudAuthService: GuestCloudAuthService,
        guestCredentialStore: GuestCloudCredentialStore,
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
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
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
        guestCloudAuthService: GuestCloudAuthService,
        guestCredentialStore: GuestCloudCredentialStore,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewTimelinePageLoader: @escaping ReviewTimelinePageLoader,
        initialGlobalErrorMessage: String
    ) {
        let cloudSyncService = database.map { initializedDatabase in
            CloudSyncService(database: initializedDatabase)
        }

        self.init(
            userDefaults: userDefaults,
            encoder: encoder,
            decoder: decoder,
            database: database,
            cloudAuthService: cloudAuthService,
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: reviewHeadLoader,
            reviewCountsLoader: reviewCountsLoader,
            reviewQueueChunkLoader: reviewQueueChunkLoader,
            reviewTimelinePageLoader: reviewTimelinePageLoader,
            initialGlobalErrorMessage: initialGlobalErrorMessage
        )
    }

    init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        database: LocalDatabase?,
        cloudAuthService: CloudAuthService,
        cloudSyncService: (any CloudSyncServing)?,
        credentialStore: CloudCredentialStore,
        guestCloudAuthService: GuestCloudAuthService,
        guestCredentialStore: GuestCloudCredentialStore,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewTimelinePageLoader: @escaping ReviewTimelinePageLoader,
        initialGlobalErrorMessage: String
    ) {
        let initialSelectedReviewFilter = FlashcardsStore.loadSelectedReviewFilter(
            userDefaults: userDefaults,
            decoder: decoder,
            workspaceId: nil
        )
        let initialReviewPublishedState = ReviewQueueRuntime.makeInitialPublishedState(
            selectedReviewFilter: initialSelectedReviewFilter
        )
        let dependencies = FlashcardsStoreDependencies(
            cloudAuthService: cloudAuthService,
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: guestCloudAuthService,
            guestCredentialStore: guestCredentialStore,
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
        self.presentedReviewCardId = initialReviewPublishedState.presentedCardId
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
        self.cloudSyncFastPollingUntil = nil
        self.pendingReviewCardIds = initialReviewPublishedState.pendingReviewCardIds
        self.reviewSubmissionFailure = initialReviewPublishedState.reviewSubmissionFailure
        self.reviewHardReminderRecentRatings = []
        self.isReviewHardReminderPresented = false
        self.currentTransientBanner = nil
        self.queuedTransientBanners = []
        self.reviewNotificationsSettings = makeDefaultReviewNotificationsSettings()
        self.notificationPermissionPromptState = loadNotificationPermissionPromptState(
            userDefaults: userDefaults,
            decoder: decoder
        )
        self.isReviewNotificationPrePromptPresented = false
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
        self.currentVisibleTab = .review
        self.lastImmediateCloudSyncTriggerAt = nil
        self.activeReviewNotificationsRescheduleTask = nil
        self.reviewNotificationsRescheduleGeneration = 0
        self.reviewHardReminderLastShownAt = loadReviewHardReminderLastShownAt(userDefaults: userDefaults)

        if database != nil && initialGlobalErrorMessage.isEmpty {
            do {
                try self.reload()
            } catch {
                self.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
        self.reviewNotificationsSettings = loadReviewNotificationsSettings(
            userDefaults: userDefaults,
            decoder: decoder,
            workspaceId: self.workspace?.workspaceId
        )

        if self.userDefaults.bool(forKey: accountDeletionPendingUserDefaultsKey) {
            self.accountDeletionState = .inProgress
        }
    }

    func currentCloudSyncPollingInterval(selectedTab: AppTab, now: Date) -> TimeInterval {
        Flashcards.currentCloudSyncPollingInterval(
            selectedTab: selectedTab,
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
