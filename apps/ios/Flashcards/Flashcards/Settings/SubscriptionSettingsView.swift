import StoreKit
import SwiftUI
import UIKit

/// The App Store Connect product whose presence decides whether the Subscription row is shown.
let premiumMonthlyProductId: String = "premium_monthly"

/// Whether the App Store returns our subscription product for this build and storefront. An empty
/// result means the product does not exist or is not approved yet, so the entry stays hidden.
func loadIsSubscriptionProductAvailable() async throws -> Bool {
    let products = try await Product.products(for: [premiumMonthlyProductId])
    return products.isEmpty == false
}

func captureSubscriptionSilentFailure(
    error: Error,
    action: String,
    cloudSettings: CloudSettings?,
    workspaceId: String?
) {
    FlashcardsObservability.captureSilentFailure(
        error: error,
        scope: IOSObservationScope(
            feature: .subscription,
            userId: cloudSettings?.linkedUserId,
            workspaceId: workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: cloudSettings?.cloudState,
            configurationMode: nil
        ),
        action: action,
        stage: nil,
        statusCode: nil,
        backendCode: nil,
        requestId: nil
    )
}

private enum SubscriptionManagementError: LocalizedError {
    case foregroundWindowSceneUnavailable

    var errorDescription: String? {
        switch self {
        case .foregroundWindowSceneUnavailable:
            return "Subscription management needs a foreground-active window scene, and none is connected"
        }
    }
}

private struct CloudEntitlementEndPresentation: Equatable {
    let title: String
    let value: String
}

/// Status first, then `until`: a missing end is lifetime access under `active` but an unknown end
/// under `in_grace`, which must never read as unlimited (docs/premium-entitlements.md, "What a client
/// receives").
private func makeCloudEntitlementEndPresentation(entitlement: CloudEntitlement) -> CloudEntitlementEndPresentation? {
    switch entitlement.status {
    case .noEntitlement:
        return nil
    case .active:
        guard let until = entitlement.until else {
            return CloudEntitlementEndPresentation(
                title: aiSettingsLocalized("settings.subscription.ends", "Ends"),
                value: aiSettingsLocalized("settings.subscription.noEndDate", "No end date")
            )
        }

        return CloudEntitlementEndPresentation(
            title: entitlement.willRenew
                ? aiSettingsLocalized("settings.subscription.renews", "Renews")
                : aiSettingsLocalized("settings.subscription.ends", "Ends"),
            value: until.formatted(date: .long, time: .omitted)
        )
    case .inGrace:
        return CloudEntitlementEndPresentation(
            title: aiSettingsLocalized("settings.subscription.graceEnds", "Grace period ends"),
            value: entitlement.until?.formatted(date: .long, time: .omitted)
                ?? aiSettingsLocalized("settings.subscription.endUnknown", "Unknown")
        )
    }
}

private func localizedCloudEntitlementStatusTitle(entitlement: CloudEntitlement) -> String {
    switch entitlement.status {
    case .noEntitlement:
        return aiSettingsLocalized("settings.subscription.status.none", "No subscription")
    case .active:
        return entitlement.isTrial
            ? aiSettingsLocalized("settings.subscription.status.trial", "Free trial")
            : aiSettingsLocalized("settings.subscription.status.active", "Active")
    case .inGrace:
        return aiSettingsLocalized("settings.subscription.status.inGrace", "Grace period")
    }
}

struct SubscriptionSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isOpeningManageSubscriptions: Bool = false

    var body: some View {
        List {
            Section {
                if let entitlement = store.cloudEntitlement {
                    LabeledContent(aiSettingsLocalized("settings.subscription.plan", "Plan")) {
                        Text(entitlement.tierDisplayName)
                    }

                    LabeledContent(aiSettingsLocalized("settings.subscription.status", "Status")) {
                        Text(localizedCloudEntitlementStatusTitle(entitlement: entitlement))
                    }

                    if let endPresentation = makeCloudEntitlementEndPresentation(entitlement: entitlement) {
                        LabeledContent(endPresentation.title) {
                            Text(endPresentation.value)
                        }
                    }
                } else {
                    Text(
                        aiSettingsLocalized(
                            "settings.subscription.planUnknown",
                            "Your plan appears here after the app syncs with your account."
                        )
                    )
                    .foregroundStyle(.secondary)
                }
            }

            Section {
                Button {
                    self.openManageSubscriptions()
                } label: {
                    HStack {
                        Text(aiSettingsLocalized("settings.subscription.manage", "Manage subscription"))

                        Spacer()

                        if self.isOpeningManageSubscriptions {
                            ProgressView()
                        }
                    }
                }
                .disabled(self.isOpeningManageSubscriptions)
                .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsManageButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.subscription.title", "Subscription"))
    }

    private func openManageSubscriptions() {
        guard self.isOpeningManageSubscriptions == false else {
            return
        }
        self.isOpeningManageSubscriptions = true

        Task { @MainActor in
            defer {
                self.isOpeningManageSubscriptions = false
            }

            do {
                let windowScene = try requireForegroundActiveWindowScene()
                try await AppStore.showManageSubscriptions(in: windowScene)
            } catch {
                self.store.presentTechnicalError(error)
            }
        }
    }
}

@MainActor
private func requireForegroundActiveWindowScene() throws -> UIWindowScene {
    let windowScene = UIApplication.shared.connectedScenes
        .compactMap { scene in
            scene as? UIWindowScene
        }
        .first { windowScene in
            windowScene.activationState == .foregroundActive
        }
    guard let windowScene else {
        throw SubscriptionManagementError.foregroundWindowSceneUnavailable
    }

    return windowScene
}

#Preview {
    NavigationStack {
        SubscriptionSettingsView()
            .environment(FlashcardsStore())
    }
}
