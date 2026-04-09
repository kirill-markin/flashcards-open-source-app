import SwiftUI

private let foundationStringsTableName: String = "Foundation"
let transientBannerDefaultDismissDelayNanoseconds: UInt64 = 3_000_000_000
let settingsWorkspaceLockedBannerMessage: String = String(
    localized: "transient_banner.workspace_changes_require_account",
    table: foundationStringsTableName,
    comment: "Banner message when workspace changes require an account"
)
let reviewUpdatedOnAnotherDeviceBannerMessage: String = String(
    localized: "transient_banner.review_updated_on_another_device",
    table: foundationStringsTableName,
    comment: "Banner message when a review is updated on another device"
)
let cardsUpdatedFromCloudBannerMessage: String = String(
    localized: "transient_banner.cards_updated_from_cloud",
    table: foundationStringsTableName,
    comment: "Banner message when cards update from the cloud"
)
let aiChatOfflineBannerMessage: String = String(
    localized: "transient_banner.ai_chat_offline",
    table: foundationStringsTableName,
    comment: "Banner message when AI chat is unavailable offline"
)
let aiChatActiveRunBannerMessage: String = String(
    localized: "transient_banner.ai_chat_active_run",
    table: foundationStringsTableName,
    comment: "Banner message when an AI response is already in progress"
)
let reviewSpeechUnavailableBannerMessage: String = String(
    localized: "transient_banner.review_speech_unavailable",
    table: foundationStringsTableName,
    comment: "Banner message when speech is unavailable on the device"
)

enum TransientBannerKind: Hashable, Sendable {
    case aiChatOffline
    case aiChatActiveRun
    case reviewUpdatedOnAnotherDevice
    case cardsUpdatedFromCloud
    case workspaceChangesRequireAccount
    case reviewSpeechUnavailable

    var iconSystemName: String {
        switch self {
        case .aiChatOffline:
            return "wifi.slash"
        case .aiChatActiveRun:
            return "hourglass"
        case .reviewUpdatedOnAnotherDevice:
            return "arrow.triangle.2.circlepath.circle.fill"
        case .cardsUpdatedFromCloud:
            return "rectangle.stack.badge.person.crop"
        case .workspaceChangesRequireAccount:
            return "gearshape.fill"
        case .reviewSpeechUnavailable:
            return "speaker.slash.fill"
        }
    }
}

struct TransientBanner: Identifiable, Hashable, Sendable {
    let id: String
    let message: String
    let kind: TransientBannerKind
    let dismissDelayNanoseconds: UInt64
}

func makeWorkspaceChangesRequireAccountBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: settingsWorkspaceLockedBannerMessage,
        kind: .workspaceChangesRequireAccount,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

func makeAIChatOfflineBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: aiChatOfflineBannerMessage,
        kind: .aiChatOffline,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

func makeAIChatActiveRunBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: aiChatActiveRunBannerMessage,
        kind: .aiChatActiveRun,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

func makeReviewUpdatedOnAnotherDeviceBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: reviewUpdatedOnAnotherDeviceBannerMessage,
        kind: .reviewUpdatedOnAnotherDevice,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

func makeCardsUpdatedFromCloudBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: cardsUpdatedFromCloudBannerMessage,
        kind: .cardsUpdatedFromCloud,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

func makeReviewSpeechUnavailableBanner(message: String) -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: message.isEmpty ? reviewSpeechUnavailableBannerMessage : message,
        kind: .reviewSpeechUnavailable,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}

struct TransientBannerView: View {
    let banner: TransientBanner
    let onDismiss: () -> Void

    @State private var dragOffsetY: CGFloat = 0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: self.banner.kind.iconSystemName)
                .imageScale(.large)
                .foregroundStyle(.primary)

            Text(self.banner.message)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: flashcardsReadableContentMaxWidth)
        .frame(maxWidth: .infinity, alignment: .center)
        .background(self.bannerBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 18, y: 8)
        .offset(y: self.dragOffsetY)
        .gesture(
            DragGesture(minimumDistance: 10)
                .onChanged { value in
                    self.dragOffsetY = min(0, value.translation.height)
                }
                .onEnded { value in
                    if value.translation.height < -18 {
                        self.onDismiss()
                    } else {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                            self.dragOffsetY = 0
                        }
                    }
                }
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    @ViewBuilder
    private var bannerBackground: some View {
        if #available(iOS 26.0, *) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.clear)
                .glassEffect()
        } else {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.thinMaterial)
        }
    }
}

struct GlobalTransientBannerHost: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                if let currentTransientBanner = self.store.currentTransientBanner {
                    TransientBannerView(
                        banner: currentTransientBanner,
                        onDismiss: {
                            self.dismissCurrentTransientBanner()
                        }
                    )
                    .allowsHitTesting(true)
                    .padding(.top, proxy.safeAreaInsets.top + 8)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .ignoresSafeArea()
        }
        .task(id: self.store.currentTransientBanner?.id) {
            await self.autoDismissCurrentTransientBanner()
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.88), value: self.store.currentTransientBanner?.id)
    }

    private func autoDismissCurrentTransientBanner() async {
        guard let currentTransientBanner = self.store.currentTransientBanner else {
            return
        }

        do {
            try await Task.sleep(nanoseconds: currentTransientBanner.dismissDelayNanoseconds)
        } catch {
            return
        }

        if Task.isCancelled {
            return
        }

        self.dismissCurrentTransientBanner()
    }

    private func dismissCurrentTransientBanner() {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            self.store.dismissCurrentTransientBanner()
        }
    }
}
