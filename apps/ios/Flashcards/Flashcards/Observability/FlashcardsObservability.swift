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

    static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?
    ) {
        self.captureSilentFailure(
            error: error,
            scope: scope,
            action: action,
            stage: stage,
            statusCode: statusCode,
            backendCode: backendCode,
            requestId: requestId,
            transportDiagnostics: nil
        )
    }

    static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?,
        transportDiagnostics: IOSNetworkTransportDiagnostics
    ) {
        self.captureSilentFailure(
            error: error,
            scope: scope,
            action: action,
            stage: stage,
            statusCode: statusCode,
            backendCode: backendCode,
            requestId: requestId,
            transportDiagnostics: .some(transportDiagnostics)
        )
    }

    private static func captureSilentFailure(
        error: Error,
        scope: IOSObservationScope,
        action: String,
        stage: String?,
        statusCode: Int?,
        backendCode: String?,
        requestId: String?,
        transportDiagnostics: IOSNetworkTransportDiagnostics?
    ) {
        self.captureException(
            .silentFailure(
                error: error,
                scope: scope,
                details: SilentFailureDetails(
                    action: action,
                    stage: stage,
                    statusCode: statusCode,
                    backendCode: backendCode,
                    requestId: requestId,
                    messageSummary: Flashcards.errorMessage(error: error),
                    transportDiagnostics: transportDiagnostics
                )
            )
        )
    }
}
