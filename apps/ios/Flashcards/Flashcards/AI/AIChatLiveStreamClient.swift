/**
 * SSE client for the thin live chat stream.
 * Opens a URLSession bytes stream to the backend SSE endpoint and parses
 * text/event-stream protocol into typed AIChatLiveEvent values.
 */
import Foundation

actor AIChatLiveStreamClient {
    private let urlSession: URLSession

    init(urlSession: URLSession) {
        self.urlSession = urlSession
    }

    func connect(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        afterCursor: String?
    ) -> AsyncThrowingStream<AIChatLiveEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var urlString = "\(liveUrl)?sessionId=\(sessionId)"
                    if let cursor = afterCursor {
                        urlString += "&afterCursor=\(cursor)"
                    }
                    guard let url = URL(string: urlString) else {
                        continuation.finish(throwing: AIChatLiveStreamError.invalidUrl)
                        return
                    }

                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue(authorization, forHTTPHeaderField: "Authorization")
                    request.timeoutInterval = 600

                    let (bytes, response) = try await self.urlSession.bytes(for: request)

                    guard let httpResponse = response as? HTTPURLResponse else {
                        continuation.finish(throwing: AIChatLiveStreamError.invalidResponse)
                        return
                    }
                    guard httpResponse.statusCode == 200 else {
                        continuation.finish(throwing: AIChatLiveStreamError.httpError(httpResponse.statusCode))
                        return
                    }

                    var currentEventType: String?
                    var currentDataLines: [String] = []

                    for try await line in bytes.lines {
                        try Task.checkCancellation()

                        if line.hasPrefix("event: ") {
                            currentEventType = String(line.dropFirst(7))
                            continue
                        }

                        if line.hasPrefix("data: ") {
                            currentDataLines.append(String(line.dropFirst(6)))
                            continue
                        }

                        if line.hasPrefix(":") {
                            continue
                        }

                        if line.isEmpty {
                            if !currentDataLines.isEmpty {
                                let payload = currentDataLines.joined(separator: "\n")
                                if let event = parseSSEEvent(eventType: currentEventType, payload: payload) {
                                    continuation.yield(event)
                                }
                            }
                            currentEventType = nil
                            currentDataLines = []
                        }
                    }

                    if !currentDataLines.isEmpty {
                        let payload = currentDataLines.joined(separator: "\n")
                        if let event = parseSSEEvent(eventType: currentEventType, payload: payload) {
                            continuation.yield(event)
                        }
                    }

                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

enum AIChatLiveStreamError: Error {
    case invalidUrl
    case invalidResponse
    case httpError(Int)
}

private func parseSSEEvent(eventType: String?, payload: String) -> AIChatLiveEvent? {
    guard let data = payload.data(using: .utf8) else {
        return nil
    }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }

    let type = eventType ?? (json["type"] as? String ?? "")

    switch type {
    case "run_state":
        guard let runState = json["runState"] as? String else { return nil }
        return .runState(runState)

    case "assistant_delta":
        guard let text = json["text"] as? String,
              let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        return .assistantDelta(text: text, cursor: cursor, itemId: itemId)

    case "assistant_tool_call":
        guard let name = json["name"] as? String,
              let statusStr = json["status"] as? String,
              let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        let status: AIChatToolCallStatus = statusStr == "completed" ? .completed : .started
        let toolCall = AIChatToolCall(
            id: itemId,
            name: name,
            status: status,
            input: json["input"] as? String,
            output: json["output"] as? String
        )
        return .assistantToolCall(toolCall, cursor: cursor, itemId: itemId)

    case "assistant_message_done":
        guard let cursor = json["cursor"] as? String,
              let itemId = json["itemId"] as? String else { return nil }
        let isError = json["isError"] as? Bool ?? false
        let isStopped = json["isStopped"] as? Bool ?? false
        return .assistantMessageDone(cursor: cursor, itemId: itemId, isError: isError, isStopped: isStopped)

    case "repair_status":
        guard let message = json["message"] as? String,
              let attempt = json["attempt"] as? Int,
              let maxAttempts = json["maxAttempts"] as? Int else { return nil }
        let toolName = json["toolName"] as? String
        return .repairStatus(AIChatRepairAttemptStatus(
            message: message,
            attempt: attempt,
            maxAttempts: maxAttempts,
            toolName: toolName
        ))

    case "error":
        guard let message = json["message"] as? String else { return nil }
        return .error(message)

    case "stop_ack":
        guard let sessionId = json["sessionId"] as? String else { return nil }
        return .stopAck(sessionId: sessionId)

    case "reset_required":
        return .resetRequired

    default:
        return nil
    }
}
