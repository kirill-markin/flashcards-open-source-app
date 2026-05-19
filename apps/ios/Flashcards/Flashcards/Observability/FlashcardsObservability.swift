import Foundation

enum FlashcardsObservability {
    static func configure(bundle: Bundle, processInfo: ProcessInfo) {
        SentryObservabilityAdapter.configure(bundle: bundle, processInfo: processInfo)
    }

    static func setIdentity(_ identity: ObservabilityIdentity?) {
        SentryObservabilityAdapter.setIdentity(identity)
    }

    static func addBreadcrumb(_ event: IOSBreadcrumbEvent) {
        SentryObservabilityAdapter.addBreadcrumb(event)
    }

    static func captureWarning(_ event: IOSWarningEvent) {
        SentryObservabilityAdapter.captureWarning(event)
    }

    static func captureException(_ event: IOSExceptionEvent) {
        SentryObservabilityAdapter.captureException(event)
    }
}

