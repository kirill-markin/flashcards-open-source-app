import Foundation

enum AIChatServiceError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(Int, String)
    case invalidStreamResponse
    case remoteError(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl(let value):
            return "AI chat base URL is invalid: \(value)"
        case .invalidResponse(let statusCode, let body):
            return "AI chat request failed with status \(statusCode): \(body)"
        case .invalidStreamResponse:
            return "AI chat did not receive an HTTP response"
        case .remoteError(let message):
            return message
        }
    }
}

struct AIChatSSEParser {
    private let decoder: JSONDecoder
    private var currentDataLines: [String]

    init(decoder: JSONDecoder) {
        self.decoder = decoder
        self.currentDataLines = []
    }

    mutating func pushLine(_ line: String) throws -> AIChatBackendStreamEvent? {
        if line.hasPrefix("data: ") {
            self.currentDataLines.append(String(line.dropFirst(6)))
            return nil
        }

        if line.isEmpty == false {
            return nil
        }

        return try self.finishEvent()
    }

    mutating func finish() throws -> [AIChatBackendStreamEvent] {
        let trailingEvent = try self.finishEvent()
        guard let trailingEvent else {
            return []
        }

        return [trailingEvent]
    }

    private mutating func finishEvent() throws -> AIChatBackendStreamEvent? {
        if self.currentDataLines.isEmpty {
            return nil
        }

        let payload = self.currentDataLines.joined(separator: "\n")
        self.currentDataLines.removeAll(keepingCapacity: true)
        let data = Data(payload.utf8)
        return try self.decoder.decode(AIChatBackendStreamEvent.self, from: data)
    }
}

final class AIChatService: AIChatStreaming, @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(session: URLSession, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.session = session
        self.encoder = encoder
        self.decoder = decoder
    }

    func streamTurn(
        session: CloudLinkedSession,
        request: AILocalChatRequestBody,
        onDelta: @escaping @Sendable (String) async -> Void,
        onToolCallRequest: @escaping @Sendable (AIToolCallRequest) async -> Void
    ) async throws -> AITurnStreamOutcome {
        var urlRequest = URLRequest(url: try self.makeURL(apiBaseUrl: session.apiBaseUrl, path: "/chat/local-turn"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(session.bearerToken)", forHTTPHeaderField: "Authorization")
        urlRequest.httpBody = try self.encoder.encode(request)

        let (bytes, response) = try await self.session.bytes(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIChatServiceError.invalidStreamResponse
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let body = try await self.readBody(bytes: bytes)
            throw AIChatServiceError.invalidResponse(httpResponse.statusCode, body)
        }

        var parser = AIChatSSEParser(decoder: self.decoder)
        var awaitsToolResults = false
        var requestedToolCalls: [AIToolCallRequest] = []

        for try await line in bytes.lines {
            if let event = try parser.pushLine(String(line)) {
                switch event {
                case .delta(let text):
                    await onDelta(text)
                case .toolCallRequest(let toolCallRequest):
                    requestedToolCalls.append(toolCallRequest)
                    await onToolCallRequest(toolCallRequest)
                case .awaitToolResults:
                    awaitsToolResults = true
                case .done:
                    return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: requestedToolCalls)
                case .error(let message):
                    throw AIChatServiceError.remoteError(message)
                }
            }
        }

        let trailingEvents = try parser.finish()
        for event in trailingEvents {
            switch event {
            case .delta(let text):
                await onDelta(text)
            case .toolCallRequest(let toolCallRequest):
                requestedToolCalls.append(toolCallRequest)
                await onToolCallRequest(toolCallRequest)
            case .awaitToolResults:
                awaitsToolResults = true
            case .done:
                return AITurnStreamOutcome(awaitsToolResults: false, requestedToolCalls: requestedToolCalls)
            case .error(let message):
                throw AIChatServiceError.remoteError(message)
            }
        }

        return AITurnStreamOutcome(awaitsToolResults: awaitsToolResults, requestedToolCalls: requestedToolCalls)
    }

    private func makeURL(apiBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = apiBaseUrl.hasSuffix("/") ? String(apiBaseUrl.dropLast()) : apiBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw AIChatServiceError.invalidBaseUrl(apiBaseUrl)
        }

        return url
    }

    private func readBody(bytes: URLSession.AsyncBytes) async throws -> String {
        var data = Data()
        for try await byte in bytes {
            data.append(byte)
        }

        return String(data: data, encoding: .utf8) ?? "<non-utf8-body>"
    }
}
