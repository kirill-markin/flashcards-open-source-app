#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import WatchConnectivity

/// WatchConnectivity documents the reply handler as callable once from any queue; the Objective-C
/// declaration just lacks the Sendable annotation.
private struct WatchHandoffReplyHandler: @unchecked Sendable {
    let send: ([String: Any]) -> Void

    func sendFailure() {
        self.send(makeWatchHandoffFailureReplyMessage())
    }
}

/// Answers the watch's sign-in handoff request; it never messages the watch on its own.
/// iPad has no paired watch, so its session simply never receives a message.
final class WatchHandoffResponder: NSObject, WCSessionDelegate, Sendable {
    private let store: FlashcardsStore

    init(store: FlashcardsStore) {
        self.store = store
    }

    func activate() {
        guard WCSession.isSupported() else {
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error {
            recordWatchHandoffFailure(stage: "session_activation", error: error)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The user switched to another paired watch; the session serves the new one once reactivated.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let replyHandler = WatchHandoffReplyHandler(send: replyHandler)
        do {
            _ = try decodeWatchHandoffRequest(message: message)
        } catch {
            recordWatchHandoffFailure(stage: "decode_request", error: error)
            replyHandler.sendFailure()
            return
        }

        let store = self.store
        Task { @MainActor in
            let result: WatchHandoffReplyResult
            let replyMessage: [String: Any]
            do {
                result = try await store.makeWatchHandoffReply()
                replyMessage = try makeWatchHandoffReplyMessage(reply: result.reply)
            } catch {
                recordWatchHandoffFailure(stage: "build_reply", error: error)
                replyHandler.sendFailure()
                return
            }

            recordWatchHandoffReply(reason: result.reason, workspaceId: result.workspaceId)
            replyHandler.send(replyMessage)
        }
    }
}

private func recordWatchHandoffReply(reason: WatchHandoffReplyReason, workspaceId: String?) {
    FlashcardsObservability.addBreadcrumb(
        .cloudFlow(
            makeWatchHandoffObservation(
                outcome: .success,
                selection: reason.rawValue,
                workspaceId: workspaceId,
                errorSummary: nil
            )
        )
    )
}

private func recordWatchHandoffFailure(stage: String, error: Error) {
    let observation = makeWatchHandoffObservation(
        outcome: .failure,
        selection: stage,
        workspaceId: nil,
        errorSummary: Flashcards.errorMessage(error: error)
    )
    FlashcardsObservability.addBreadcrumb(.cloudFlow(observation))
    FlashcardsObservability.captureWarning(.cloudFlow(observation))
}

private func makeWatchHandoffObservation(
    outcome: CloudFlowOutcome,
    selection: String,
    workspaceId: String?,
    errorSummary: String?
) -> CloudFlowObservation {
    CloudFlowObservation(
        phase: .watchHandoff,
        outcome: outcome,
        scope: IOSObservationScope(
            feature: cloudObservationFeature(phase: .watchHandoff),
            userId: nil,
            workspaceId: workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: nil,
            configurationMode: nil
        ),
        requestId: nil,
        backendCode: nil,
        statusCode: nil,
        workspaceId: workspaceId,
        installationId: nil,
        selection: selection,
        sourceWorkspaceId: nil,
        targetWorkspaceId: nil,
        migrationKind: nil,
        remoteWorkspaceIsEmpty: nil,
        operationsCount: nil,
        reviewScheduleImpactingOperationCount: nil,
        changesCount: nil,
        errorSummary: errorSummary
    )
}
#endif
