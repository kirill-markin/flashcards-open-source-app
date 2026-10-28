import Foundation

/// The last valid `reviewPrompts` from `GET /me`, kept per install.
let reviewPromptRemoteConfigUserDefaultsKey: String = "review-prompt-remote-config-v1"

private let knownReviewPromptSettingKeys: Set<String> = [
    "enabled",
    "minTotalReviews",
    "minReviewsToday",
    "minReviewDays",
    "cooldownDays"
]

/// `reviewPrompts` from `GET /me` kept as raw JSON, so a malformed config never fails the `/me` read.
indirect enum ReviewPromptRemoteConfigJSON: Decodable, Hashable, Sendable {
    case object([String: ReviewPromptRemoteConfigJSON])
    case array([ReviewPromptRemoteConfigJSON])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([ReviewPromptRemoteConfigJSON].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: ReviewPromptRemoteConfigJSON].self))
        }
    }
}

struct ReviewPromptRemoteConfigError: LocalizedError, Hashable, Sendable {
    let message: String

    var errorDescription: String? {
        self.message
    }
}

/// Validates the whole remote config; any malformed value rejects all of it.
func parseRemoteReviewPromptConfig(json: ReviewPromptRemoteConfigJSON) throws -> ReviewPromptConfig {
    guard case .object(let fields) = json else {
        throw ReviewPromptRemoteConfigError(message: "reviewPrompts is not an object: \(json)")
    }
    guard case .number(let schemaVersion)? = fields["schemaVersion"], schemaVersion == 1 else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.schemaVersion is unsupported: \(String(describing: fields["schemaVersion"]))"
        )
    }
    // `productAnalyticsReviewPromptConfigVersionPattern` in apps/backend/src/productAnalytics/catalog.ts.
    guard case .string(let version)? = fields["version"],
          version.wholeMatch(of: /[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?/) != nil else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.version is invalid: \(String(describing: fields["version"]))"
        )
    }
    // Released app builds reject paywall state with a second-paywall showing and no initial one, so a
    // remote config must not disable `paywall-initial` or order it after `paywall-second` while such
    // builds are in use.
    guard case .array(let orderValues)? = fields["order"] else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.order is not an array: \(String(describing: fields["order"]))"
        )
    }
    let order = try orderValues.map { value in
        guard case .string(let promptId) = value else {
            throw ReviewPromptRemoteConfigError(message: "reviewPrompts.order has a non-string entry: \(value)")
        }
        return promptId
    }
    guard case .object(let promptValues)? = fields["prompts"] else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.prompts is not an object: \(String(describing: fields["prompts"]))"
        )
    }
    var prompts: [String: ReviewPromptSettings] = [:]
    for (promptId, value) in promptValues where ReviewPromptId(rawValue: promptId) != nil {
        prompts[promptId] = try parseRemoteReviewPromptSettings(promptId: promptId, json: value)
    }

    return ReviewPromptConfig(schemaVersion: 1, version: version, order: order, prompts: prompts)
}

/// A prompt with a setting this app does not understand is disabled.
private func parseRemoteReviewPromptSettings(
    promptId: String,
    json: ReviewPromptRemoteConfigJSON
) throws -> ReviewPromptSettings {
    guard case .object(let fields) = json else {
        throw ReviewPromptRemoteConfigError(message: "reviewPrompts.prompts.\(promptId) is not an object: \(json)")
    }
    guard case .bool(let enabled)? = fields["enabled"] else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.prompts.\(promptId).enabled is not a boolean: \(String(describing: fields["enabled"]))"
        )
    }
    let hasUnknownSetting = fields.keys.contains { key in
        knownReviewPromptSettingKeys.contains(key) == false
    }

    return ReviewPromptSettings(
        enabled: enabled && hasUnknownSetting == false,
        minTotalReviews: try parseRemoteReviewPromptCount(promptId: promptId, key: "minTotalReviews", fields: fields),
        minReviewsToday: try parseRemoteReviewPromptCount(promptId: promptId, key: "minReviewsToday", fields: fields),
        minReviewDays: try parseRemoteReviewPromptCount(promptId: promptId, key: "minReviewDays", fields: fields),
        cooldownDays: try parseRemoteReviewPromptCount(promptId: promptId, key: "cooldownDays", fields: fields)
    )
}

private func parseRemoteReviewPromptCount(
    promptId: String,
    key: String,
    fields: [String: ReviewPromptRemoteConfigJSON]
) throws -> Int? {
    guard let value = fields[key] else {
        return nil
    }
    guard case .number(let number) = value, number >= 0, let count = Int(exactly: number) else {
        throw ReviewPromptRemoteConfigError(
            message: "reviewPrompts.prompts.\(promptId).\(key) is not a non-negative integer: \(value)"
        )
    }
    return count
}

/// The cached remote config, or the built-in defaults until the first valid one arrives.
func loadActiveReviewPromptConfig(userDefaults: UserDefaults, decoder: JSONDecoder) -> ReviewPromptConfig {
    guard let data = userDefaults.data(forKey: reviewPromptRemoteConfigUserDefaultsKey) else {
        return builtInReviewPromptConfig
    }

    do {
        return try decoder.decode(ReviewPromptConfig.self, from: data)
    } catch {
        captureReviewPromptConfigSilentFailure(error: error, action: "review_prompt_config_cache_load", stage: "decode")
        userDefaults.removeObject(forKey: reviewPromptRemoteConfigUserDefaultsKey)
        return builtInReviewPromptConfig
    }
}

func captureReviewPromptConfigSilentFailure(error: Error, action: String, stage: String) {
    FlashcardsObservability.captureSilentFailure(
        error: error,
        scope: IOSObservationScope(
            feature: .prompts,
            userId: nil,
            workspaceId: nil,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: nil,
            configurationMode: nil
        ),
        action: action,
        stage: stage,
        statusCode: nil,
        backendCode: nil,
        requestId: nil
    )
}
