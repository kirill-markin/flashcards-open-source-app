import SwiftUI

extension CloudAuthProvider {
    var displayName: String { self == .apple ? "Apple" : "Google" }
    var analyticsMethod: AnalyticsAuthMethod { self == .apple ? .apple : .google }
}

enum AccountMethodCopy: String {
    case title, link, unlink, reenable, generation, readOnly, cleanup, confirmCurrent
    case confirmNewProvider, fresh, lastUsable, conflict, changed, demo, refreshFailed
}

func accountMethodCopy(_ copy: AccountMethodCopy) -> String {
    let english: String
    switch copy {
    case .title: english = "Sign-in methods"
    case .link: english = "Link provider"
    case .unlink: english = "Unlink provider"
    case .reenable: english = "Re-enable provider"
    case .generation: english = "Generation"
    case .readOnly: english = "Verified recovery emails are read-only. Only the addresses listed here are proved."
    case .cleanup: english = "Provider cleanup is pending. Refresh until it finishes, then start again with fresh proof."
    case .confirmCurrent: english = "First verify your current account with an active sign-in method. This does not switch accounts."
    case .confirmNewProvider: english = "Now verify the provider account for this change. Use the intended provider account."
    case .fresh: english = "This change did not finish or its proof expired. Refresh methods, then start again with fresh proof."
    case .lastUsable: english = "Keep another active provider or a verified recovery email before unlinking."
    case .conflict: english = "This provider belongs to another account. Choose another provider account."
    case .changed: english = "This method changed. Refresh methods and start again."
    case .demo: english = "Demo accounts cannot manage sign-in methods. Sign in with your own account."
    case .refreshFailed: english = "Methods could not be refreshed. Refresh before starting a new change."
    }
    return aiSettingsLocalized("settings.account.methods.\(copy.rawValue)", english)
}

func accountMethodOperationTitle(_ operation: CloudAccountMethodOperation) -> String {
    switch operation {
    case .link: return accountMethodCopy(.link)
    case .unlink: return accountMethodCopy(.unlink)
    case .reenable: return accountMethodCopy(.reenable)
    }
}

func accountMethodErrorMessage(_ error: Error) -> String {
    if let error = error as? CloudAccountMethodError {
        switch error {
        case .methodChanged: return accountMethodCopy(.changed)
        case .cleanupRequired: return accountMethodCopy(.cleanup)
        case .sessionRequired, .currentAccountChanged, .currentEmailUnavailable:
            return localizedCloudCredentialRecoveryWrongLinkedAccountMessage()
        case .freshAttemptRequired, .invalidPhase: return accountMethodCopy(.fresh)
        }
    }
    if case CloudAuthError.invalidResponse(let details, _) = error {
        switch details.code {
        case "ACCOUNT_CONNECTION_PREVIEW_CHANGED": return connectionCopy(.previewChanged)
        case "ACCOUNT_CONNECTION_RESTART_REQUIRED", "ACCOUNT_CONNECTION_INVALID": return connectionCopy(.restart)
        case "LAST_USABLE_METHOD": return accountMethodCopy(.lastUsable)
        case "PROVIDER_METHOD_CHANGED": return accountMethodCopy(.changed)
        case "PROVIDER_METHOD_CLEANUP_REQUIRED", "APPLE_REVOCATION_PENDING": return accountMethodCopy(.cleanup)
        case "PROVIDER_ENROLLMENT_CONFLICT": return accountMethodCopy(.conflict)
        case "PROVIDER_SIGN_IN_DENIED": return accountMethodCopy(.demo)
        case "SESSION_REQUIRED", "SESSION_REVOKED", "PRINCIPAL_SIGNOUT_PENDING", "ACCOUNT_DELETED":
            return localizedCloudCredentialRecoveryWrongLinkedAccountMessage()
        default: return accountMethodCopy(.fresh)
        }
    }
    return accountMethodCopy(.fresh)
}

func recordAccountMethodObservation(_ observation: CloudAccountMethodObservation) {
    switch observation {
    case .providerRequested(let provider):
        Analytics.track(.authProviderRequested(method: provider == .apple ? .apple : .google, screen: .settings))
    case .providerFinished(let provider, let outcome):
        Analytics.track(.authProviderFinished(method: provider == .apple ? .apple : .google, outcome: outcome, screen: .settings))
    case .codeRequestFinished(let method, let outcome):
        Analytics.track(.authCodeRequestFinished(method: method.analyticsMethod, action: .initial, outcome: outcome, screen: .settings))
    case .codeVerificationFinished(let method, let outcome):
        Analytics.track(.authCodeVerificationFinished(method: method.analyticsMethod, outcome: outcome, screen: .settings))
    case .linkFinished(let provider, let outcome):
        Analytics.track(.authAccountLinkFinished(method: provider.analyticsMethod, outcome: outcome, screen: .settings))
    case .mutationConfirmed(let mutation, let provider):
        if case .link = mutation {
            Analytics.track(.authAccountLinkFinished(method: provider.analyticsMethod, outcome: .linked, screen: .settings))
        }
    }
}

struct AccountMethodViewIdentity: Hashable {
    let configuration: CloudServiceConfiguration?
    let userId: String?
    let state: CloudAccountState?
}

struct AccountMethodPresenter: UIViewControllerRepresentable {
    let onReady: (UIViewController) -> Void
    func makeUIViewController(context: Context) -> UIViewController { UIViewController() }
    func updateUIViewController(_ controller: UIViewController, context: Context) {
        DispatchQueue.main.async { self.onReady(controller) }
    }
}

enum ConnectionCopy: String {
    case title, suggestion, data, settings, billing, destination, hidden, omit, preserve, confirm
    case connected, alreadyConnected, cancelled, uncertain, replay, preview, previewChanged, restart, restorePaused
}

func connectionCopy(_ copy: ConnectionCopy) -> String {
    let english: String
    switch copy {
    case .title: english = "Connect accounts"
    case .suggestion: english = "Review suggested account connection"
    case .data: english = "Cards, reviews and workspaces stay. Memberships combine; ownership takes precedence."
    case .settings: english = "Destination settings and public profile apply with stricter privacy. Keep the genuine primary email, or use a proved real email."
    case .billing: english = "Purchases, grants, usage and integration credentials follow the connected account. Subscriptions and original trial history stay unchanged."
    case .destination: english = "Selected destination"
    case .hidden: english = "Hidden from workspace choices"
    case .omit: english = "Request omission if eligible"
    case .preserve: english = "Only eligible starters may be hidden. Backing data stays; other workspaces remain."
    case .confirm: english = "Confirm account connection"
    case .restorePaused: english = "Accounts connected. Local refresh is paused; your offline data is retained."
    case .connected: english = "Accounts connected."
    case .alreadyConnected: english = "These accounts are already connected."
    case .cancelled: english = "Connection cancelled."
    case .uncertain: english = "Confirmation was sent, but its result is unknown. Check it using the same confirmation."
    case .replay: english = "Check confirmation result"
    case .preview: english = "Refresh connection preview"
    case .previewChanged: english = "The preview changed. Refresh it and confirm the new preview explicitly."
    case .restart: english = "Connection proof expired or was consumed. Start again with fresh proof."
    }
    return aiSettingsLocalized("settings.account.connection.\(copy.rawValue)", english)
}
