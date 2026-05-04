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

func isProgressConsumerTab(tab: AppTab) -> Bool {
    tab == .review || tab == .progress
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
    var presentedReviewCard: Card?
    var reviewCounts: ReviewCounts
    var isReviewHeadLoading: Bool
    var isReviewCountsLoading: Bool
    var isReviewQueueChunkLoading: Bool
    var homeSnapshot: HomeSnapshot
    var progressSnapshot: ProgressSnapshot?
    var reviewScheduleSnapshot: ReviewScheduleSnapshot?
    var reviewProgressBadgeState: ReviewProgressBadgeState
    var progressErrorMessage: String
    var isProgressRefreshing: Bool
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
    var strictRemindersSettings: StrictRemindersSettings
    var notificationPermissionPromptState: NotificationPermissionPromptState
    var isReviewNotificationPrePromptPresented: Bool
    var accountDeletionState: AccountDeletionState
    var accountDeletionSuccessMessage: String?
    var uiTestLaunchPreparationStatus: FlashcardsUITestLaunchPreparationStatus
    var localReadVersion: Int

    @ObservationIgnored let database: LocalDatabase?
    @ObservationIgnored let dependencies: FlashcardsStoreDependencies
    @ObservationIgnored let userDefaults: UserDefaults
    @ObservationIgnored let encoder: JSONEncoder
    @ObservationIgnored let decoder: JSONDecoder
    @ObservationIgnored var cloudServiceConfigurationValidator: any CloudServiceConfigurationValidating
    @ObservationIgnored var reviewRuntime: ReviewQueueRuntime
    @ObservationIgnored var reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate
    @ObservationIgnored var cloudRuntime: CloudSessionRuntime
    @ObservationIgnored var isAccountDeletionRunning: Bool
    @ObservationIgnored var isGuestUpgradeLocalOutboxMutationBlocked: Bool
    @ObservationIgnored var cachedAIChatStore: AIChatStore?
    @ObservationIgnored var currentVisibleTab: AppTab
    @ObservationIgnored var lastImmediateCloudSyncTriggerAt: Date?
    @ObservationIgnored var activeReviewNotificationsRescheduleTask: Task<Void, Never>?
    @ObservationIgnored var reviewNotificationsRescheduleGeneration: Int
    @ObservationIgnored var activeStrictRemindersRescheduleTask: Task<Void, Never>?
    @ObservationIgnored var pendingStrictRemindersReconcileRequest: StrictRemindersReconcileRequest?
    @ObservationIgnored var reviewHardReminderLastShownAt: Date?
    @ObservationIgnored var progressSummaryServerBaseCache: PersistedProgressSummaryServerBase?
    @ObservationIgnored var progressSeriesServerBaseCache: PersistedProgressSeriesServerBase?
    @ObservationIgnored var progressReviewScheduleServerBaseCache: PersistedReviewScheduleServerBase?
    @ObservationIgnored var progressObservedScopeKey: ProgressScopeKey?
    @ObservationIgnored var progressErrorState: ProgressErrorState
    @ObservationIgnored var progressSummaryInvalidatedScopeKeys: Set<ProgressSummaryScopeKey>
    @ObservationIgnored var progressSeriesInvalidatedScopeKeys: Set<ProgressScopeKey>
    @ObservationIgnored var progressReviewScheduleInvalidatedScopeKeys: Set<ReviewScheduleScopeKey>
    @ObservationIgnored var progressSummaryRefreshToken: Int
    @ObservationIgnored var progressSeriesRefreshToken: Int
    @ObservationIgnored var progressReviewScheduleRefreshToken: Int
    @ObservationIgnored var progressActiveSummaryRefreshScopeKey: ProgressSummaryScopeKey?
    @ObservationIgnored var progressActiveSeriesRefreshScopeKey: ProgressScopeKey?
    @ObservationIgnored var progressActiveReviewScheduleRefreshScopeKey: ReviewScheduleScopeKey?
    @ObservationIgnored var progressActiveSummaryRefreshToken: Int?
    @ObservationIgnored var progressActiveSeriesRefreshToken: Int?
    @ObservationIgnored var progressActiveReviewScheduleRefreshToken: Int?
    @ObservationIgnored var isProgressSummaryRefreshing: Bool
    @ObservationIgnored var isProgressSeriesRefreshing: Bool
    @ObservationIgnored var isProgressReviewScheduleRefreshing: Bool
    @ObservationIgnored var progressLocalFallbackRevision: Int
    @ObservationIgnored var progressReviewedAtClientCache: ProgressReviewedAtClientCacheEntry?
    @ObservationIgnored var progressReviewScheduleLocalCache: ProgressReviewScheduleLocalCacheEntry?

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
        let reviewSubmissionOutboxMutationGate = ReviewSubmissionOutboxMutationGate()
        let reviewSubmissionExecutor: ReviewSubmissionExecuting? = database.map { initializedDatabase in
            ReviewSubmissionExecutor(
                databaseURL: initializedDatabase.databaseURL,
                outboxMutationGate: reviewSubmissionOutboxMutationGate
            )
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
            reviewSubmissionOutboxMutationGate: reviewSubmissionOutboxMutationGate,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: defaultReviewHeadLoader,
            reviewCountsLoader: defaultReviewCountsLoader,
            reviewQueueChunkLoader: defaultReviewQueueChunkLoader,
            reviewQueueWindowLoader: defaultReviewQueueWindowLoader,
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
        reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewQueueWindowLoader: @escaping ReviewQueueWindowLoader,
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
            reviewSubmissionOutboxMutationGate: reviewSubmissionOutboxMutationGate,
            reviewSubmissionExecutor: reviewSubmissionExecutor,
            reviewHeadLoader: reviewHeadLoader,
            reviewCountsLoader: reviewCountsLoader,
            reviewQueueChunkLoader: reviewQueueChunkLoader,
            reviewQueueWindowLoader: reviewQueueWindowLoader,
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
        reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate,
        reviewSubmissionExecutor: ReviewSubmissionExecuting?,
        reviewHeadLoader: @escaping ReviewHeadLoader,
        reviewCountsLoader: @escaping ReviewCountsLoader,
        reviewQueueChunkLoader: @escaping ReviewQueueChunkLoader,
        reviewQueueWindowLoader: @escaping ReviewQueueWindowLoader,
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
            reviewQueueWindowLoader: reviewQueueWindowLoader,
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
        self.presentedReviewCard = initialReviewPublishedState.presentedReviewCard
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
        self.progressSnapshot = nil
        self.reviewScheduleSnapshot = nil
        self.reviewProgressBadgeState = makeEmptyReviewProgressBadgeState()
        self.progressErrorMessage = ""
        self.isProgressRefreshing = false
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
        self.strictRemindersSettings = loadStrictRemindersSettings(
            userDefaults: userDefaults,
            decoder: decoder
        )
        self.notificationPermissionPromptState = loadNotificationPermissionPromptState(
            userDefaults: userDefaults,
            decoder: decoder
        )
        self.isReviewNotificationPrePromptPresented = false
        self.accountDeletionState = .hidden
        self.accountDeletionSuccessMessage = nil
        self.uiTestLaunchPreparationStatus = .hidden
        self.localReadVersion = 0
        self.database = database
        self.dependencies = dependencies
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.cloudServiceConfigurationValidator = CloudServiceConfigurationValidator()
        self.reviewRuntime = ReviewQueueRuntime(
            reviewSeedQueueSize: reviewSeedQueueSize,
            reviewQueueReplenishmentThreshold: reviewQueueReplenishmentThreshold
        )
        self.reviewSubmissionOutboxMutationGate = reviewSubmissionOutboxMutationGate
        self.cloudRuntime = CloudSessionRuntime(
            cloudAuthService: dependencies.cloudAuthService,
            cloudSyncService: dependencies.cloudSyncService,
            credentialStore: dependencies.credentialStore
        )
        self.isAccountDeletionRunning = false
        self.isGuestUpgradeLocalOutboxMutationBlocked = false
        self.currentVisibleTab = .review
        self.lastImmediateCloudSyncTriggerAt = nil
        self.activeReviewNotificationsRescheduleTask = nil
        self.reviewNotificationsRescheduleGeneration = 0
        self.activeStrictRemindersRescheduleTask = nil
        self.pendingStrictRemindersReconcileRequest = nil
        self.reviewHardReminderLastShownAt = loadReviewHardReminderLastShownAt(userDefaults: userDefaults)
        self.progressSummaryServerBaseCache = nil
        self.progressSeriesServerBaseCache = nil
        self.progressReviewScheduleServerBaseCache = nil
        self.progressObservedScopeKey = nil
        self.progressErrorState = makeEmptyProgressErrorState()
        self.progressSummaryInvalidatedScopeKeys = []
        self.progressSeriesInvalidatedScopeKeys = []
        self.progressReviewScheduleInvalidatedScopeKeys = []
        self.progressSummaryRefreshToken = 0
        self.progressSeriesRefreshToken = 0
        self.progressReviewScheduleRefreshToken = 0
        self.progressActiveSummaryRefreshScopeKey = nil
        self.progressActiveSeriesRefreshScopeKey = nil
        self.progressActiveReviewScheduleRefreshScopeKey = nil
        self.progressActiveSummaryRefreshToken = nil
        self.progressActiveSeriesRefreshToken = nil
        self.progressActiveReviewScheduleRefreshToken = nil
        self.isProgressSummaryRefreshing = false
        self.isProgressSeriesRefreshing = false
        self.isProgressReviewScheduleRefreshing = false
        self.progressLocalFallbackRevision = 0
        self.progressReviewedAtClientCache = nil
        self.progressReviewScheduleLocalCache = nil

        if database != nil && initialGlobalErrorMessage.isEmpty {
            do {
                try self.reload(now: Date(), refreshVisibleProgress: false)
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
