import Foundation

/**
 * The external connector for one analytics ingest request.
 *
 * `@unchecked Sendable` because `AnalyticsRuntime` owns the only reference and serializes every call.
 * The session and JSON codecs are created once and never reconfigured after initialization.
 */
final class AnalyticsTransport: @unchecked Sendable {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(session: URLSession?) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.waitsForConnectivity = false
            self.session = URLSession(configuration: configuration)
        }
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func send(
        anonymousId: String,
        sessionId: String,
        payloads: [AnalyticsEventPayload],
        credentials: AnalyticsCredentials
    ) async throws -> AnalyticsSendOutcome {
        // clientSentAt is stamped here, at the moment of the request, because the server derives
        // occurred_at from the interval between it and clientOccurredAt.
        let batch = AnalyticsBatchPayload(
            clientSentAt: analyticsTimestampString(date: Date()),
            anonymousId: anonymousId,
            sessionId: sessionId,
            context: analyticsClientContextPayload(),
            events: payloads
        )

        let body = try self.encoder.encode(batch)
        let request = try makeAnalyticsIngestRequest(
            credentials: credentials,
            body: body
        )
        logAnalyticsOutgoingRequestIfEnabled(request: request, body: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            // Ordinary offline and transient transport failures are deliberately not reported: this
            // repository already silences them in every background capture path.
            return .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            return .retryLater(retryAfterSeconds: nil, isServerError: false)
        }

        let retryAfterSeconds = analyticsRetryAfterSeconds(
            value: httpResponse.value(forHTTPHeaderField: "Retry-After")
        )
        logAnalyticsResponseIfEnabled(httpResponse: httpResponse, data: data)

        switch httpResponse.statusCode {
        case 200:
            guard let ingestResponse = try? self.decoder.decode(AnalyticsIngestResponse.self, from: data) else {
                // The batch was accepted even if the envelope could not be read, and redelivery is
                // safe but pointless, so the events are still finished.
                return .completed(rejectedCount: 0)
            }
            return .completed(rejectedCount: ingestResponse.rejected.count)
        case 400, 413:
            return .wholeBatchRefused
        case 401, 403, 410:
            return .credentialUnusable
        default:
            return .retryLater(
                retryAfterSeconds: retryAfterSeconds,
                isServerError: httpResponse.statusCode >= 500
            )
        }
    }
}

enum AnalyticsRequestError: LocalizedError, Equatable {
    case invalidIngestUrl(String)

    var errorDescription: String? {
        switch self {
        case .invalidIngestUrl(let apiBaseUrl):
            return "Analytics ingest URL could not be built from \(apiBaseUrl)"
        }
    }
}

enum AnalyticsSendOutcome: Sendable {
    case completed(rejectedCount: Int)
    case wholeBatchRefused
    case retryLater(retryAfterSeconds: TimeInterval?, isServerError: Bool)
    case credentialUnusable
}

func analyticsRetryAfterSeconds(value: String?) -> TimeInterval? {
    guard let nanoseconds = cloudRetryAfterDelayNanoseconds(value: value) else {
        return nil
    }

    return min(analyticsRetryMaximumDelaySeconds, Double(nanoseconds) / 1_000_000_000)
}

/**
 * Builds the ingest request. The path is asserted rather than joined loosely: `POST
 * /v1/analytics/events/` answers 404 on purpose and also misses the endpoint's tighter throttle and
 * all three of its alarms, so a base URL that normalises to a trailing slash would lose every event
 * silently. `X-Client-Platform` and `X-Client-Version` are set per endpoint in this repository, and
 * `product_events` is append-only, so a batch shipped without them is unattributable forever.
 */
func makeAnalyticsIngestRequest(credentials: AnalyticsCredentials, body: Data) throws -> URLRequest {
    let trimmedBaseUrl = credentials.apiBaseUrl.hasSuffix("/")
        ? String(credentials.apiBaseUrl.dropLast())
        : credentials.apiBaseUrl
    guard let url = URL(string: "\(trimmedBaseUrl)\(analyticsEventsPath)"),
          url.path.hasSuffix("/") == false,
          url.path.hasSuffix(analyticsEventsPath) else {
        throw AnalyticsRequestError.invalidIngestUrl(credentials.apiBaseUrl)
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(credentials.authorizationHeaderValue, forHTTPHeaderField: "Authorization")
    request.setValue(analyticsClientPlatformHeaderValue, forHTTPHeaderField: "X-Client-Platform")
    request.setValue(appMarketingVersion(), forHTTPHeaderField: "X-Client-Version")
    request.httpBody = body
    return request
}

/// Device context, describing the device at flush time.
func analyticsClientContextPayload() -> AnalyticsContextPayload {
    let operatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
    return AnalyticsContextPayload(
        osVersion: "\(operatingSystemVersion.majorVersion).\(operatingSystemVersion.minorVersion).\(operatingSystemVersion.patchVersion)",
        deviceModel: analyticsDeviceModelIdentifier(),
        deviceLocale: Locale.current.identifier(.bcp47),
        timezone: TimeZone.current.identifier
    )
}

func analyticsDeviceModelIdentifier() -> String? {
    if let simulatorModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
        return simulatorModel
    }

    var systemInfo = utsname()
    guard uname(&systemInfo) == 0 else {
        return nil
    }

    let machine = systemInfo.machine
    let identifier = withUnsafePointer(to: machine) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: machine)) { characters in
            String(cString: characters)
        }
    }
    return identifier.isEmpty ? nil : identifier
}

let analyticsRequestDebugLogEnvironmentKey: String = "FLASHCARDS_ANALYTICS_LOG_REQUEST"

/**
 * Prints the exact outgoing batch when the launch environment asks for it. This is how the wire format
 * is checked against a live endpoint — the path, both `X-Client-*` headers, the `Z` timestamps and the
 * version nibble of every `eventId` — rather than by reading the code that produced them. Off unless
 * the variable is set, and the catalog admits no free-text property, so the body carries no user data.
 */
func logAnalyticsOutgoingRequestIfEnabled(request: URLRequest, body: Data) {
    guard ProcessInfo.processInfo.environment[analyticsRequestDebugLogEnvironmentKey] != nil else {
        return
    }

    let headers = request.allHTTPHeaderFields ?? [:]
    let redactedHeaders = headers.map { key, value in
        "\(key)=\(key.lowercased() == "authorization" ? "<redacted>" : value)"
    }.sorted().joined(separator: " ")
    fputs("analytics_request url=\(request.url?.absoluteString ?? "-") \(redactedHeaders)\n", stderr)
    fputs("analytics_request_body \(String(decoding: body, as: UTF8.self))\n", stderr)
}

func logAnalyticsResponseIfEnabled(httpResponse: HTTPURLResponse, data: Data) {
    guard ProcessInfo.processInfo.environment[analyticsRequestDebugLogEnvironmentKey] != nil else {
        return
    }

    let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id") ?? "-"
    fputs(
        "analytics_response status=\(httpResponse.statusCode) requestId=\(requestId) body=\(String(decoding: data, as: UTF8.self))\n",
        stderr
    )
}
