import Foundation

enum AIChatFailureStage: String, Codable, Hashable, Sendable {
    case requestBuild = "request_build"
    case invalidHttpResponse = "invalid_http_response"
    case httpResponseBody = "http_response_body"
    case responseNotOk = "response_not_ok"
    case readingLine = "reading_line"
    case finishingEvent = "finishing_event"
    case decodingEventJSON = "decoding_event_json"
    case processingTrailingEvent = "processing_trailing_event"
    case backendErrorEvent = "backend_error_event"
    case runTerminal = "run_terminal"
    case toolInputDecode = "tool_input_decode"
    case toolExecution = "tool_execution"
}

enum AIChatFailureKind: String, Codable, Hashable, Sendable {
    case invalidBaseUrl = "invalid_base_url"
    case invalidStreamResponse = "invalid_stream_response"
    case invalidHttpResponse = "invalid_http_response"
    case staleStream = "stale_stream"
    case invalidSSEFraming = "invalid_sse_framing"
    case invalidSSEEventJSON = "invalid_sse_event_json"
    case invalidStreamContract = "invalid_stream_contract"
    case backendErrorEvent = "backend_error_event"
    case runTerminalError = "run_terminal_error"
    case invalidToolInput = "invalid_tool_input"
    case toolExecutionFailed = "tool_execution_failed"
}

struct AIChatFailureDiagnostics: Codable, Hashable, Sendable {
    let clientRequestId: String
    let backendRequestId: String?
    let stage: AIChatFailureStage
    let errorKind: AIChatFailureKind
    let statusCode: Int?
    let eventType: String?
    let toolName: String?
    let toolCallId: String?
    let lineNumber: Int?
    let rawSnippet: String?
    let decoderSummary: String?
    let continuationAttempt: Int?
    let continuationToolCallIds: [String]
}

protocol AIChatFailureDiagnosticProviding: Error {
    var diagnostics: AIChatFailureDiagnostics { get }
}
