import Foundation
import WatchConnectivity

enum WatchConnectivityClientError: LocalizedError {
    case activationFailed(description: String)
    case notActivated(activationState: Int)
    case activationTimedOut(seconds: Int)
    case iPhoneUnreachable
    case replyTimedOut(seconds: Int)
    case sendFailed(domain: String, code: Int, description: String)
    case replyDecodingFailed(payloadDescription: String, decodingDescription: String)

    var errorDescription: String? {
        switch self {
        case .activationFailed(let description):
            return "WatchConnectivity session activation failed: \(description)"
        case .notActivated(let activationState):
            return "WatchConnectivity session is not activated: activationState=\(activationState)"
        case .activationTimedOut(let seconds):
            return "WatchConnectivity session did not finish activating within \(seconds) seconds"
        case .iPhoneUnreachable:
            return "The paired iPhone is not reachable"
        case .replyTimedOut(let seconds):
            return "The iPhone app did not answer the watch handoff request within \(seconds) seconds"
        case .sendFailed(let domain, let code, let description):
            return "Watch handoff request failed: domain=\(domain) code=\(code) \(description)"
        case .replyDecodingFailed(let payloadDescription, let decodingDescription):
            return "Watch handoff reply could not be decoded: \(decodingDescription); payload: \(payloadDescription)"
        }
    }
}

/// What the reply handler received, decoded to Sendable values on the WatchConnectivity queue.
private enum WatchHandoffTransportResult: Sendable {
    case reply(Result<WatchHandoffReply, Error>)
    case sendFailed(domain: String, code: Int, description: String)
    case replyTimedOut
}

/// WatchConnectivity never times out a delivered message the iPhone app does not answer, for example
/// an iPhone app version without the responder, so the watch bounds the wait itself.
private let watchHandoffReplyTimeoutSeconds: Int = 20

/// Resumes the reply continuation once, whichever of the reply, the error or the timeout comes first.
private final class WatchHandoffReplyGate: @unchecked Sendable {
    private let lock: NSLock
    private var continuation: CheckedContinuation<WatchHandoffTransportResult, Never>?

    init(continuation: CheckedContinuation<WatchHandoffTransportResult, Never>) {
        self.lock = NSLock()
        self.continuation = continuation
    }

    func resume(returning result: WatchHandoffTransportResult) {
        self.lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        self.lock.unlock()
        continuation?.resume(returning: result)
    }
}

/// Activation can stay pending while the watch has not finished connecting to its iPhone.
private let watchConnectivityActivationTimeoutSeconds: Int = 10

/// Asks the paired iPhone for its account through `WCSession.sendMessage`, the only transport that
/// answers immediately; the iPhone side replies with a `WatchHandoffReply`.
@MainActor
final class WatchConnectivityClient: NSObject, WCSessionDelegate {
    private var activationWaiters: [UUID: CheckedContinuation<Void, Error>]
    private var onIPhoneBecameReachable: (@MainActor () -> Void)?

    override init() {
        self.activationWaiters = [:]
        self.onIPhoneBecameReachable = nil
        super.init()
    }

    var isIPhoneReachable: Bool {
        WCSession.default.activationState == .activated && WCSession.default.isReachable
    }

    func activate(onIPhoneBecameReachable: @escaping @MainActor () -> Void) {
        self.onIPhoneBecameReachable = onIPhoneBecameReachable
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func requestHandoff() async throws -> WatchHandoffReply {
        try await self.waitForActivation()
        guard WCSession.default.isReachable else {
            throw WatchConnectivityClientError.iPhoneUnreachable
        }

        switch try await sendHandoffRequest() {
        case .reply(let reply):
            return try reply.get()
        case .sendFailed(let domain, let code, let description):
            if domain == WCErrorDomain && code == WCError.Code.notReachable.rawValue {
                throw WatchConnectivityClientError.iPhoneUnreachable
            }
            throw WatchConnectivityClientError.sendFailed(domain: domain, code: code, description: description)
        case .replyTimedOut:
            throw WatchConnectivityClientError.replyTimedOut(seconds: watchHandoffReplyTimeoutSeconds)
        }
    }

    private func waitForActivation() async throws {
        switch WCSession.default.activationState {
        case .activated:
            return
        case .notActivated, .inactive:
            let waiterId = UUID()
            try await withCheckedThrowingContinuation { continuation in
                self.activationWaiters[waiterId] = continuation
                Task { @MainActor in
                    do {
                        try await Task.sleep(for: .seconds(watchConnectivityActivationTimeoutSeconds))
                    } catch {
                        return
                    }
                    self.activationWaiters.removeValue(forKey: waiterId)?.resume(
                        throwing: WatchConnectivityClientError.activationTimedOut(seconds: watchConnectivityActivationTimeoutSeconds)
                    )
                }
            }
        @unknown default:
            throw WatchConnectivityClientError.notActivated(activationState: WCSession.default.activationState.rawValue)
        }
    }

    private func completeActivation(activationState: WCSessionActivationState, errorDescription: String?) {
        let waiters = self.activationWaiters.values
        self.activationWaiters = [:]
        for waiter in waiters {
            if let errorDescription {
                waiter.resume(throwing: WatchConnectivityClientError.activationFailed(description: errorDescription))
            } else if activationState == .activated {
                waiter.resume()
            } else {
                waiter.resume(throwing: WatchConnectivityClientError.notActivated(activationState: activationState.rawValue))
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let errorDescription = error.map { activationError in String(describing: activationError) }
        Task { @MainActor in
            self.completeActivation(activationState: activationState, errorDescription: errorDescription)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else {
            return
        }
        Task { @MainActor in
            self.onIPhoneBecameReachable?()
        }
    }
}

/// Nonisolated so the WatchConnectivity callbacks, which arrive on a background queue, are not
/// main-actor closures.
private func sendHandoffRequest() async throws -> WatchHandoffTransportResult {
    let requestMessage = try makeWatchHandoffRequestMessage(
        request: WatchHandoffRequest(contractVersion: watchHandoffContractVersion)
    )
    return await withCheckedContinuation { continuation in
        let gate = WatchHandoffReplyGate(continuation: continuation)
        DispatchQueue.global(qos: .userInitiated).asyncAfter(
            deadline: .now() + .seconds(watchHandoffReplyTimeoutSeconds)
        ) {
            gate.resume(returning: .replyTimedOut)
        }
        WCSession.default.sendMessage(
            requestMessage,
            replyHandler: { reply in
                gate.resume(returning: .reply(Result { try decodeHandoffReplyMessage(message: reply) }))
            },
            errorHandler: { error in
                let nsError = error as NSError
                gate.resume(
                    returning: .sendFailed(domain: nsError.domain, code: nsError.code, description: nsError.localizedDescription)
                )
            }
        )
    }
}

/// The reply carries tokens, so a decoding failure reports only the payload's keys and types and where
/// decoding stopped, never values.
private func decodeHandoffReplyMessage(message: [String: Any]) throws -> WatchHandoffReply {
    do {
        return try decodeWatchHandoffReply(message: message)
    } catch let decodingError as DecodingError {
        throw WatchConnectivityClientError.replyDecodingFailed(
            payloadDescription: describeHandoffPayload(message: message),
            decodingDescription: describeHandoffDecodingError(error: decodingError)
        )
    }
}

private func describeHandoffPayload(message: [String: Any]) -> String {
    let entries = message.sorted { left, right in left.key < right.key }.map { entry in
        "\(entry.key): \(type(of: entry.value))"
    }
    return "[\(entries.joined(separator: ", "))]"
}

private func describeHandoffDecodingError(error: DecodingError) -> String {
    let context: DecodingError.Context
    let kind: String
    switch error {
    case .typeMismatch(let type, let errorContext):
        kind = "typeMismatch(\(type))"
        context = errorContext
    case .valueNotFound(let type, let errorContext):
        kind = "valueNotFound(\(type))"
        context = errorContext
    case .keyNotFound(let key, let errorContext):
        kind = "keyNotFound(\(key.stringValue))"
        context = errorContext
    case .dataCorrupted(let errorContext):
        kind = "dataCorrupted"
        context = errorContext
    @unknown default:
        return "unknown decoding error"
    }
    let codingPath = context.codingPath.map(\.stringValue).joined(separator: ".")
    return "\(kind) at '\(codingPath)': \(context.debugDescription)"
}
