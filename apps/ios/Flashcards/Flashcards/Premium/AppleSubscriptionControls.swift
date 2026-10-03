import StoreKit
import SwiftUI
import UIKit

struct AppleSubscriptionControls: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppleSubscriptionService.self) private var subscriptions: AppleSubscriptionService
    let onRestore: () -> Void

    @State private var isBusy: Bool = false
    @State private var message: String?

    var body: some View {
        Section {
            ForEach(self.subscriptions.currentPurchases, id: \.id) { purchase in
                LabeledContent("App Store") {
                    Text(purchase.productID)
                }
                if let expiration = purchase.expirationDate {
                    LabeledContent(aiSettingsLocalized("settings.subscription.ends", "Ends")) {
                        Text(expiration, format: .dateTime.year().month().day())
                    }
                }
            }

            Button(aiSettingsLocalized("premium.apple.restore", "Restore purchases")) {
                self.restore()
            }
            .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsRestoreButton)

            Button(aiSettingsLocalized("settings.subscription.manage", "Manage subscription")) {
                self.manage()
            }
            .accessibilityIdentifier(UITestIdentifier.subscriptionSettingsManageButton)

            if self.isBusy { ProgressView() }
            if let message {
                Text(message).accessibilityIdentifier(UITestIdentifier.subscriptionSettingsMessage)
            }
        }
        .disabled(self.isBusy)
    }

    private func restore() {
        self.isBusy = true
        self.message = nil
        Task { @MainActor in
            defer { self.isBusy = false }
            let identity = try? self.store.appleSubscriptionIdentity()
            do {
                try await self.subscriptions.restorePurchases()
                guard identity == (try? self.store.appleSubscriptionIdentity()) else { return }
                self.message = self.subscriptions.currentPurchases.isEmpty
                    ? aiSettingsLocalized("settings.subscription.status.none", "No subscription")
                    : aiSettingsLocalized("common.done", "Done")
                self.onRestore()
            } catch {
                guard identity == (try? self.store.appleSubscriptionIdentity()) else { return }
                self.message = aiSettingsLocalized("premium.apple.failed", "Purchase could not be confirmed. Restore purchases to retry without buying again.") + "\n" + error.localizedDescription
            }
        }
    }

    private func manage() {
        self.isBusy = true
        self.message = nil
        Task { @MainActor in
            defer { self.isBusy = false }
            let identity = try? self.store.appleSubscriptionIdentity()
            do {
                let scene = UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .first { $0.activationState == .foregroundActive }
                guard let scene else { throw AppleSubscriptionManagementError.sceneUnavailable }
                try await self.subscriptions.manageSubscriptions(in: scene)
                guard identity == (try? self.store.appleSubscriptionIdentity()) else { return }
                try await self.subscriptions.reconcileCurrentEntitlements()
            } catch {
                guard identity == (try? self.store.appleSubscriptionIdentity()) else { return }
                self.message = aiSettingsLocalized("premium.apple.failed", "Purchase could not be confirmed. Restore purchases to retry without buying again.") + "\n" + error.localizedDescription
            }
        }
    }
}

private enum AppleSubscriptionManagementError: LocalizedError {
    case sceneUnavailable
    var errorDescription: String? {
        aiSettingsLocalized("premium.apple.sceneUnavailable", "Open the app in the foreground to manage your subscription.")
    }
}
