/**
 * SSE client for the thin live chat stream.
 * Opens a URLSession bytes stream to the backend SSE endpoint and parses
 * text/event-stream protocol into typed AIChatLiveEvent values.
 */
import Foundation

struct AIChatLiveStreamConfiguration: Sendable {
    let requestTimeoutSeconds: TimeInterval
    let resourceTimeoutSeconds: TimeInterval
    let inactivityTimeoutSeconds: TimeInterval
}

private let aiChatDefaultLiveStreamConfiguration = AIChatLiveStreamConfiguration(
    requestTimeoutSeconds: 600,
    resourceTimeoutSeconds: 600,
    inactivityTimeoutSeconds: 45
)

actor AIChatLiveStreamClient {
    private let fallbackSession: URLSession
    private let decoder: JSONDecoder
    private let configuration: AIChatLiveStreamConfiguration

    init(
        urlSession: URLSession,
        decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder()
    ) {
        self.init(
            urlSession: urlSession,
            decoder: decoder,
            configuration: aiChatDefaultLiveStreamConfiguration
        )
    }

    init(
        urlSession: URLSession,
        decoder: JSONDecoder,
        configuration: AIChatLiveStreamConfiguration
    ) {
        self.fallbackSession = urlSession
        self.decoder = decoder
        self.configuration = configuration
    }

    func connect(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        configurationMode: CloudServiceConfigurationMode,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) -> AsyncThrowingStream<AIChatLiveStreamElement, Error> {
        let decoder = self.decoder
        let fallbackConfiguration = self.fallbackSession.configuration
        let liveConfiguration = self.configuration
        let clientRequestId = makeAIChatClientRequestId()
        return AsyncThrowingStream { continuation in
            do {
                let url = try makeAIChatLiveStreamURL(
                    liveUrl: liveUrl,
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: afterCursor,
                    clientRequestId: clientRequestId
                )
                logAIChatLiveClientEvent(
                    action: "ai_live_connect_start",
                    metadata: [
                        "sessionId": sessionId,
                        "runId": runId,
                        "afterCursor": afterCursor ?? "-",
                        "liveUrl": liveUrl,
                        "clientRequestId": clientRequestId
                    ]
                    .merging(
                        resumeAttemptDiagnostics.map { ["resumeAttempt": $0.headerValue] } ?? [:]
                    ) { _, newValue in newValue }
                )

                var request = URLRequest(url: url)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
                request.setValue(authorization, forHTTPHeaderField: "Authorization")
                request.setValue(clientRequestId, forHTTPHeaderField: "X-Chat-Request-Id")
                if let resumeAttemptDiagnostics {
                    request.setValue(
                        resumeAttemptDiagnostics.headerValue,
                        forHTTPHeaderField: "X-Chat-Resume-Attempt-Id"
                    )
                    request.setValue(aiChatClientPlatform, forHTTPHeaderField: "X-Client-Platform")
                    request.setValue(aiChatAppVersion(), forHTTPHeaderField: "X-Client-Version")
                }
                request.timeoutInterval = liveConfiguration.requestTimeoutSeconds

                let delegate = AIChatLiveStreamTaskDelegate(
                    continuation: continuation,
                    sessionId: sessionId,
                    runId: runId,
                    afterCursor: afterCursor,
                    clientRequestId: clientRequestId,
                    configurationMode: configurationMode,
                    decoder: decoder,
                    liveConfiguration: liveConfiguration,
                    callbackQueue: DispatchQueue(
                        label: "AIChatLiveStreamClient.callback"
                    )
                )
                let configuration = fallbackConfiguration.copy() as? URLSessionConfiguration
                    ?? .ephemeral
                configuration.timeoutIntervalForRequest = liveConfiguration.requestTimeoutSeconds
                configuration.timeoutIntervalForResource = liveConfiguration.resourceTimeoutSeconds
                configuration.waitsForConnectivity = false
                let delegateQueue = OperationQueue()
                delegateQueue.maxConcurrentOperationCount = 1
                delegateQueue.underlyingQueue = delegate.callbackQueue
                let session = URLSession(
                    configuration: configuration,
                    delegate: delegate,
                    delegateQueue: delegateQueue
                )
                let task = session.dataTask(with: request)
                delegate.start(task: task, session: session)
                task.resume()

                continuation.onTermination = { _ in
                    task.cancel()
                }
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}
