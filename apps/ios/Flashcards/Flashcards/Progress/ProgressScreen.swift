import Foundation
import SwiftUI

enum ProgressScreenSectionID: Hashable {
    case streak
    case leaderboard
    case streakLeaderboard
}

private struct ProgressPresentationTaskID: Hashable {
    let requestID: UUID?
    let hasStreakSection: Bool
    let hasLeaderboardSection: Bool
    let hasStreakLeaderboardSection: Bool
}

struct ProgressScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @Environment(ProgressScreenState.self) private var progressState: ProgressScreenState
    @Environment(\.tabBarPlacement) private var tabBarPlacement
    @State private var selectedLeaderboardProfile: ProgressLeaderboardSelectedProfile?
    @State private var isCloudSignInPresented: Bool = false
    @State private var isFriendInvitePresented: Bool = false

    private var usesTopTabNavigation: Bool {
        UIDevice.current.userInterfaceIdiom == .pad && self.tabBarPlacement == .topBar
    }

    private var usesPairedCompanionToolbar: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
            && self.navigation.isAICompanionVisible && self.navigation.selectedTab == .progress
    }

    private var isLeaderboardSectionAvailable: Bool {
        self.store.progressSnapshot != nil && self.store.progressLeaderboardSnapshot != nil
    }

    private var isStreakSectionAvailable: Bool {
        self.store.progressSnapshot != nil
    }

    private var isStreakLeaderboardSectionAvailable: Bool {
        self.store.progressSnapshot != nil && self.store.progressStreakLeaderboardSnapshot != nil
    }

    private var progressPresentationTaskID: ProgressPresentationTaskID {
        ProgressPresentationTaskID(
            requestID: self.navigation.progressPresentationRequest?.id,
            hasStreakSection: self.isStreakSectionAvailable,
            hasLeaderboardSection: self.isLeaderboardSectionAvailable,
            hasStreakLeaderboardSection: self.isStreakLeaderboardSectionAvailable
        )
    }

    var body: some View {
        self.bodyContent
        .cloudSignInSheet(
            isPresented: self.$isCloudSignInPresented,
            presentationContext: .standard(originSurface: .progress)
        )
        .friendInviteSheet(isPresented: self.$isFriendInvitePresented, store: self.store)
        .sheet(item: self.$selectedLeaderboardProfile) { selectedProfile in
            ProgressLeaderboardProfileSheet(selectedProfile: selectedProfile)
                .environment(self.store)
        }
    }

    private var bodyContent: some View {
        @Bindable var progressState = self.progressState
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ProgressErrorBanner(message: self.store.progressErrorMessage)

                    if let progressSnapshot = self.store.progressSnapshot {
                        ProgressLoadedSections(
                            progressSnapshot: progressSnapshot,
                            leaderboardSnapshot: self.store.progressLeaderboardSnapshot,
                            streakLeaderboardSnapshot: self.store.progressStreakLeaderboardSnapshot,
                            reviewScheduleSnapshot: self.store.reviewScheduleSnapshot,
                            isProgressRefreshing: self.store.isProgressRefreshing,
                            leaderboardRefreshMessage: self.store.progressErrorState.leaderboardRefreshMessage,
                            streakLeaderboardRefreshMessage: self.store.progressErrorState.streakLeaderboardRefreshMessage,
                            leaderboardWindowSelection: $progressState.leaderboardWindowSelection,
                            reviewChartPageSelection: $progressState.reviewChartPageSelection,
                            onOpenCloudSignIn: self.openCloudSignInFlow,
                            onOpenFriendInvite: self.openFriendInviteFlow,
                            onOpenProfile: self.openLeaderboardProfile
                        )
                    } else if self.store.isProgressRefreshing == false {
                        ProgressUnavailableCard()
                    }
                }
                .frame(maxWidth: flashcardsReadableContentMaxWidth)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
            }
            .scrollPosition($progressState.scrollPosition)
            .onScrollPhaseChange { _, newPhase, context in
                let geometry = context.geometry
                // A recreated scroll view starts at the bound position, so the resting offset becomes it.
                // Pull-to-refresh rests above the top edge; binding that offset would hold the refresh gap open.
                guard newPhase == .idle, geometry.contentOffset.y >= -geometry.contentInsets.top else {
                    return
                }
                self.progressState.scrollPosition = ScrollPosition(point: geometry.contentOffset)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .accessibilityIdentifier(UITestIdentifier.progressScreen)
            .nativeNavigationTitle(
                (self.usesTopTabNavigation || self.usesPairedCompanionToolbar) ? "" : String(
                    localized: "progress.screen.title",
                    defaultValue: "Progress",
                    table: "Foundation",
                    comment: "Progress screen title"
                )
            )
            .navigationBarTitleDisplayMode(UIDevice.current.userInterfaceIdiom == .pad ? .inline : .automatic)
            .refreshable {
                await self.store.refreshProgressManually()
            }
            .task(id: self.progressPresentationTaskID) {
                await self.handleProgressPresentationRequest(proxy: proxy)
            }
        }
        .toolbar {
            #if !targetEnvironment(macCatalyst)
            AICompanionToolbarItem()
            #endif
        }

    }

    private func openCloudSignInFlow() {
        self.isCloudSignInPresented = true
    }

    private func openFriendInviteFlow() {
        guard self.store.cloudSettings?.cloudState == .linked else {
            self.isCloudSignInPresented = true
            return
        }

        self.isFriendInvitePresented = true
    }

    private func openLeaderboardProfile(_ selectedProfile: ProgressLeaderboardSelectedProfile) {
        self.selectedLeaderboardProfile = selectedProfile
    }

    @MainActor
    private func handleProgressPresentationRequest(proxy: ScrollViewProxy) async {
        guard let request = self.navigation.progressPresentationRequest else {
            return
        }
        if request.target == .leaderboard {
            self.progressState.leaderboardWindowSelection = nil
        }

        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }
        await Task.yield()
        guard self.navigation.progressPresentationRequest?.id == request.id else {
            return
        }
        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }

        withAnimation(self.reduceMotion ? nil : .default) {
            proxy.scrollTo(self.progressScreenSectionID(target: request.target), anchor: .top)
        }
        self.navigation.clearProgressPresentationRequest(id: request.id)
    }

    private func isProgressPresentationTargetAvailable(target: ProgressPresentationTarget) -> Bool {
        switch target {
        case .streak:
            return self.isStreakSectionAvailable
        case .leaderboard:
            return self.isLeaderboardSectionAvailable
        }
    }

    private func progressScreenSectionID(target: ProgressPresentationTarget) -> ProgressScreenSectionID {
        switch target {
        case .streak:
            return .streak
        case .leaderboard:
            return .leaderboard
        }
    }
}

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
            .environment(ProgressScreenState())
    }
}
