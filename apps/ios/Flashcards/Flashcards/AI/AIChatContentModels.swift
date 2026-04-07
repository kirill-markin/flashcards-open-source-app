import Foundation

private let aiChatPersistedUnknownType: String = "__unknown__"

func aiChatAppVersion() -> String {
    appMarketingVersion()
}

func makeAIChatSessionId() -> String {
    UUID().uuidString.lowercased()
}

func aiChatResolvedSessionId(
    workspaceId: String?,
    sessionId: String
) -> String {
    let trimmedSessionId = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedSessionId.isEmpty == false {
        return trimmedSessionId
    }

    _ = workspaceId
    return ""
}

func aiChatLastLocalUserMessageTimestamp(messages: [AIChatMessage]) -> Date? {
    for message in messages.reversed() {
        guard message.role == .user else {
            continue
        }
        guard let timestamp = parseIsoTimestamp(value: message.timestamp) else {
            continue
        }

        return timestamp
    }

    return nil
}

func aiChatShouldOpenFreshLocalSession(
    messages: [AIChatMessage],
    now: Date
) -> Bool {
    guard let lastUserMessageTimestamp = aiChatLastLocalUserMessageTimestamp(messages: messages) else {
        return false
    }

    return now.timeIntervalSince(lastUserMessageTimestamp) > aiChatLocalSessionStalenessThreshold
}

func makeAIChatClientRequestId() -> String {
    UUID().uuidString.lowercased()
}

func aiChatTruncatedSnippet(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= 240 {
        return trimmed
    }

    let endIndex = trimmed.index(trimmed.startIndex, offsetBy: 240)
    return String(trimmed[..<endIndex]) + "..."
}

func aiChatDecoderSummary(error: Error) -> String {
    if let decodingError = error as? DecodingError {
        switch decodingError {
        case .dataCorrupted(let context):
            return context.debugDescription
        case .keyNotFound(let key, let context):
            return "missing key \(key.stringValue): \(context.debugDescription)"
        case .typeMismatch(let type, let context):
            return "type mismatch \(type): \(context.debugDescription)"
        case .valueNotFound(let type, let context):
            return "missing value \(type): \(context.debugDescription)"
        @unknown default:
            return String(describing: decodingError)
        }
    }

    return Flashcards.errorMessage(error: error)
}

func makeAIChatSnapshotMessageId(
    sessionId: String,
    index: Int,
    role: AIChatRole,
    timestamp: String
) -> String {
    let seed = [
        sessionId,
        String(index),
        role.rawValue,
        timestamp
    ].joined(separator: "#")

    return "snapshot-\(aiChatStableSeedHash(seed))"
}

private func aiChatStableSeedHash(_ value: String) -> String {
    var hash: UInt64 = 1_469_598_103_934_665_603
    for byte in value.utf8 {
        hash ^= UInt64(byte)
        hash &*= 1_099_511_628_211
    }

    return String(hash, radix: 16)
}

enum AIChatRole: String, Codable, Hashable, Sendable {
    case user
    case assistant
}

enum AIChatToolCallStatus: String, Codable, Hashable, Sendable {
    case started
    case completed
}

struct AIChatToolCall: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let status: AIChatToolCallStatus
    let input: String?
    let output: String?
}

struct AIChatReasoningSummary: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let summary: String
    let status: AIChatToolCallStatus
}

struct AIChatUnknownContentPart: Codable, Hashable, Sendable {
    let originalType: String
    let summaryText: String
    let rawPayloadJSON: String?
}

struct AIChatUnknownAttachmentPayload: Codable, Hashable, Sendable {
    let originalType: String
    let summaryText: String
    let rawPayloadJSON: String?
}

private struct AIChatStreamPositionPayload: Decodable {
    let itemId: String
}

private struct AIChatDynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

private indirect enum AIChatRawJSONValue: Hashable, Sendable, Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AIChatRawJSONValue])
    case array([AIChatRawJSONValue])
    case null

    init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: AIChatDynamicCodingKey.self) {
            var values: [String: AIChatRawJSONValue] = [:]
            for key in container.allKeys {
                values[key.stringValue] = try container.decode(AIChatRawJSONValue.self, forKey: key)
            }
            self = .object(values)
            return
        }

        if var container = try? decoder.unkeyedContainer() {
            var values: [AIChatRawJSONValue] = []
            while container.isAtEnd == false {
                values.append(try container.decode(AIChatRawJSONValue.self))
            }
            self = .array(values)
            return
        }

        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
        } else if let booleanValue = try? container.decode(Bool.self) {
            self = .bool(booleanValue)
        } else if let numberValue = try? container.decode(Double.self) {
            self = .number(numberValue)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported AI chat raw JSON value."
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .string(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .number(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .bool(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .object(let values):
            var container = encoder.container(keyedBy: AIChatDynamicCodingKey.self)
            for key in values.keys.sorted() {
                guard let codingKey = AIChatDynamicCodingKey(stringValue: key) else {
                    continue
                }
                try container.encode(values[key], forKey: codingKey)
            }
        case .array(let values):
            var container = encoder.unkeyedContainer()
            for value in values {
                try container.encode(value)
            }
        case .null:
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        }
    }
}

private func aiChatUnknownContentSummaryText(originalType: String) -> String {
    "Unsupported content (type: \(originalType))"
}

private func aiChatUnknownAttachmentSummaryText(originalType: String) -> String {
    "Unsupported attachment (type: \(originalType))"
}

private func aiChatEncodedRawPayloadJSON(rawPayload: AIChatRawJSONValue) -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(rawPayload) else {
        return nil
    }

    return String(data: data, encoding: .utf8)
}

private func makeAIChatUnknownContentPart(
    originalType: String,
    rawPayload: AIChatRawJSONValue
) -> AIChatUnknownContentPart {
    AIChatUnknownContentPart(
        originalType: originalType,
        summaryText: aiChatUnknownContentSummaryText(originalType: originalType),
        rawPayloadJSON: aiChatEncodedRawPayloadJSON(rawPayload: rawPayload)
    )
}

private func makeAIChatUnknownAttachmentPayload(
    originalType: String,
    rawPayload: AIChatRawJSONValue
) -> AIChatUnknownAttachmentPayload {
    AIChatUnknownAttachmentPayload(
        originalType: originalType,
        summaryText: aiChatUnknownAttachmentSummaryText(originalType: originalType),
        rawPayloadJSON: aiChatEncodedRawPayloadJSON(rawPayload: rawPayload)
    )
}

private enum AIChatContentPartDecodingKeys: String, CodingKey {
    case type
    case text
    case mediaType
    case base64Data
    case fileName
    case cardId
    case frontText
    case backText
    case tags
    case effortLevel
    case id
    case name
    case status
    case input
    case output
    case summary
    case streamPosition
    case buttonTitle
    case originalType
    case summaryText
    case rawPayloadJSON
}

func logAIChatUnknownContentParts(
    content: [AIChatContentPart],
    sessionId: String,
    messageId: String,
    source: String
) {
    for part in content {
        guard case .unknown(let unknownPart) = part else {
            continue
        }

        logAIChatStoreEvent(
            action: "ai_chat_unknown_content_received",
            metadata: [
                "originalType": unknownPart.originalType,
                "sessionId": sessionId.isEmpty ? "-" : sessionId,
                "messageId": messageId.isEmpty ? "-" : messageId,
                "source": source
            ]
        )
    }
}

struct AIChatAttachment: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let payload: Payload

    enum Payload: Codable, Hashable, Sendable {
        case binary(fileName: String, mediaType: String, base64Data: String)
        case card(AIChatCardReference)
        case unknown(AIChatUnknownAttachmentPayload)

        private enum CodingKeys: String, CodingKey {
            case type
            case fileName
            case mediaType
            case base64Data
            case cardId
            case frontText
            case backText
            case tags
            case effortLevel
            case originalType
            case summaryText
            case rawPayloadJSON
        }

        init(from decoder: Decoder) throws {
            let rawPayload = try AIChatRawJSONValue(from: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let type = try container.decode(String.self, forKey: .type)

            switch type {
            case "binary":
                self = .binary(
                    fileName: try container.decode(String.self, forKey: .fileName),
                    mediaType: try container.decode(String.self, forKey: .mediaType),
                    base64Data: try container.decode(String.self, forKey: .base64Data)
                )
            case "card":
                self = .card(
                    AIChatCardReference(
                        cardId: try container.decode(String.self, forKey: .cardId),
                        frontText: try container.decode(String.self, forKey: .frontText),
                        backText: try container.decode(String.self, forKey: .backText),
                        tags: try container.decode([String].self, forKey: .tags),
                        effortLevel: try container.decode(EffortLevel.self, forKey: .effortLevel)
                    )
                )
            case aiChatPersistedUnknownType:
                self = .unknown(
                    AIChatUnknownAttachmentPayload(
                        originalType: try container.decode(String.self, forKey: .originalType),
                        summaryText: try container.decode(String.self, forKey: .summaryText),
                        rawPayloadJSON: try container.decodeIfPresent(String.self, forKey: .rawPayloadJSON)
                    )
                )
            default:
                self = .unknown(
                    makeAIChatUnknownAttachmentPayload(
                        originalType: type,
                        rawPayload: rawPayload
                    )
                )
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)

            switch self {
            case .binary(let fileName, let mediaType, let base64Data):
                try container.encode("binary", forKey: .type)
                try container.encode(fileName, forKey: .fileName)
                try container.encode(mediaType, forKey: .mediaType)
                try container.encode(base64Data, forKey: .base64Data)
            case .card(let card):
                try container.encode("card", forKey: .type)
                try container.encode(card.cardId, forKey: .cardId)
                try container.encode(card.frontText, forKey: .frontText)
                try container.encode(card.backText, forKey: .backText)
                try container.encode(card.tags, forKey: .tags)
                try container.encode(card.effortLevel, forKey: .effortLevel)
            case .unknown(let payload):
                try container.encode(aiChatPersistedUnknownType, forKey: .type)
                try container.encode(payload.originalType, forKey: .originalType)
                try container.encode(payload.summaryText, forKey: .summaryText)
                try container.encodeIfPresent(payload.rawPayloadJSON, forKey: .rawPayloadJSON)
            }
        }
    }

    var isImage: Bool {
        guard case .binary(_, let mediaType, _) = self.payload else {
            return false
        }

        return mediaType.hasPrefix("image/")
    }
}

enum AIChatContentPart: Codable, Hashable, Sendable {
    case text(String)
    case image(mediaType: String, base64Data: String)
    case file(fileName: String, mediaType: String, base64Data: String)
    case card(AIChatCardReference)
    case toolCall(AIChatToolCall)
    case reasoningSummary(AIChatReasoningSummary)
    case accountUpgradePrompt(message: String, buttonTitle: String)
    case unknown(AIChatUnknownContentPart)

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case mediaType
        case base64Data
        case fileName
        case cardId
        case frontText
        case backText
        case tags
        case effortLevel
        case id
        case name
        case status
        case input
        case output
        case summary
        case streamPosition
        case buttonTitle
        case originalType
        case summaryText
        case rawPayloadJSON
    }

    init(from decoder: Decoder) throws {
        self = try decodeAIChatContentPart(decoder: decoder)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .image(let mediaType, let base64Data):
            try container.encode("image", forKey: .type)
            try container.encode(mediaType, forKey: .mediaType)
            try container.encode(base64Data, forKey: .base64Data)
        case .file(let fileName, let mediaType, let base64Data):
            try container.encode("file", forKey: .type)
            try container.encode(fileName, forKey: .fileName)
            try container.encode(mediaType, forKey: .mediaType)
            try container.encode(base64Data, forKey: .base64Data)
        case .card(let card):
            try container.encode("card", forKey: .type)
            try container.encode(card.cardId, forKey: .cardId)
            try container.encode(card.frontText, forKey: .frontText)
            try container.encode(card.backText, forKey: .backText)
            try container.encode(card.tags, forKey: .tags)
            try container.encode(card.effortLevel, forKey: .effortLevel)
        case .toolCall(let toolCall):
            try container.encode("tool_call", forKey: .type)
            try container.encode(toolCall.id, forKey: .id)
            try container.encode(toolCall.name, forKey: .name)
            try container.encode(toolCall.status, forKey: .status)
            try container.encodeIfPresent(toolCall.input, forKey: .input)
            try container.encodeIfPresent(toolCall.output, forKey: .output)
        case .reasoningSummary(let reasoningSummary):
            try container.encode("reasoning_summary", forKey: .type)
            try container.encode(reasoningSummary.id, forKey: .id)
            try container.encode(reasoningSummary.summary, forKey: .summary)
            try container.encode(reasoningSummary.status, forKey: .status)
        case .accountUpgradePrompt(let message, let buttonTitle):
            try container.encode("account_upgrade_prompt", forKey: .type)
            try container.encode(message, forKey: .text)
            try container.encode(buttonTitle, forKey: .buttonTitle)
        case .unknown(let payload):
            try container.encode(aiChatPersistedUnknownType, forKey: .type)
            try container.encode(payload.originalType, forKey: .originalType)
            try container.encode(payload.summaryText, forKey: .summaryText)
            try container.encodeIfPresent(payload.rawPayloadJSON, forKey: .rawPayloadJSON)
        }
    }

    var textValue: String? {
        switch self {
        case .text(let text):
            return text
        case .image, .file, .card, .toolCall, .reasoningSummary, .accountUpgradePrompt, .unknown:
            return nil
        }
    }

    var toolCallValue: AIChatToolCall? {
        switch self {
        case .toolCall(let toolCall):
            return toolCall
        case .text, .image, .file, .card, .reasoningSummary, .accountUpgradePrompt, .unknown:
            return nil
        }
    }

    var reasoningSummaryValue: String? {
        switch self {
        case .reasoningSummary(let reasoningSummary):
            return reasoningSummary.summary
        case .text, .image, .file, .card, .toolCall, .accountUpgradePrompt, .unknown:
            return nil
        }
    }
}

private struct AIChatDecodableContentPartPayload: Decodable {
    let value: AIChatContentPart

    init(from decoder: Decoder) throws {
        self.value = try decodeAIChatContentPart(decoder: decoder)
    }
}

func decodeAIChatContentParts<Key: CodingKey>(
    container: KeyedDecodingContainer<Key>,
    key: Key
) throws -> [AIChatContentPart] {
    try container.decode([AIChatDecodableContentPartPayload].self, forKey: key).map(\.value)
}

private func decodeAIChatContentPart(decoder: Decoder) throws -> AIChatContentPart {
    let rawPayload = try AIChatRawJSONValue(from: decoder)
    let container = try decoder.container(keyedBy: AIChatContentPartDecodingKeys.self)
    let type = try container.decode(String.self, forKey: .type)

    switch type {
    case "text":
        return .text(try container.decode(String.self, forKey: .text))
    case "image":
        return .image(
            mediaType: try container.decode(String.self, forKey: .mediaType),
            base64Data: try container.decode(String.self, forKey: .base64Data)
        )
    case "file":
        return .file(
            fileName: try container.decode(String.self, forKey: .fileName),
            mediaType: try container.decode(String.self, forKey: .mediaType),
            base64Data: try container.decode(String.self, forKey: .base64Data)
        )
    case "card":
        return .card(
            AIChatCardReference(
                cardId: try container.decode(String.self, forKey: .cardId),
                frontText: try container.decode(String.self, forKey: .frontText),
                backText: try container.decode(String.self, forKey: .backText),
                tags: try container.decode([String].self, forKey: .tags),
                effortLevel: try container.decode(EffortLevel.self, forKey: .effortLevel)
            )
        )
    case "tool_call":
        return .toolCall(
            AIChatToolCall(
                id: try container.decode(String.self, forKey: .id),
                name: try container.decode(String.self, forKey: .name),
                status: try container.decode(AIChatToolCallStatus.self, forKey: .status),
                input: try container.decodeIfPresent(String.self, forKey: .input),
                output: try container.decodeIfPresent(String.self, forKey: .output)
            )
        )
    case "reasoning_summary":
        let summary = try container.decode(String.self, forKey: .summary)
        let streamPosition = try container.decodeIfPresent(AIChatStreamPositionPayload.self, forKey: .streamPosition)
        let reasoningId = try container.decodeIfPresent(String.self, forKey: .id)
            ?? streamPosition?.itemId
            ?? summary
        return .reasoningSummary(
            AIChatReasoningSummary(
                id: reasoningId,
                summary: summary,
                status: .completed
            )
        )
    case "account_upgrade_prompt":
        return .accountUpgradePrompt(
            message: try container.decode(String.self, forKey: .text),
            buttonTitle: try container.decode(String.self, forKey: .buttonTitle)
        )
    case aiChatPersistedUnknownType:
        return .unknown(
            AIChatUnknownContentPart(
                originalType: try container.decode(String.self, forKey: .originalType),
                summaryText: try container.decode(String.self, forKey: .summaryText),
                rawPayloadJSON: try container.decodeIfPresent(String.self, forKey: .rawPayloadJSON)
            )
        )
    default:
        return .unknown(
            makeAIChatUnknownContentPart(
                originalType: type,
                rawPayload: rawPayload
            )
        )
    }
}

struct AIChatMessage: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let role: AIChatRole
    let content: [AIChatContentPart]
    let timestamp: String
    let isError: Bool
    let isStopped: Bool
    let cursor: String?
    let itemId: String?

    private enum CodingKeys: String, CodingKey {
        case id = "messageId"
        case role
        case content
        case timestamp
        case timestampMillis
        case isError
        case isStopped
        case cursor
        case itemId
    }

    init(
        id: String,
        role: AIChatRole,
        content: [AIChatContentPart],
        timestamp: String,
        isError: Bool,
        isStopped: Bool,
        cursor: String?,
        itemId: String?
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.isError = isError
        self.isStopped = isStopped
        self.cursor = cursor
        self.itemId = itemId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.role = try container.decode(AIChatRole.self, forKey: .role)
        self.content = try decodeAIChatContentParts(container: container, key: .content)
        if let timestampMillis = try? container.decode(Int.self, forKey: .timestamp) {
            self.timestamp = isoTimestampFromMilliseconds(timestampMillis)
        } else if let timestamp = try? container.decode(String.self, forKey: .timestamp) {
            self.timestamp = timestamp
        } else if let timestampMillis = try? container.decode(Int.self, forKey: .timestampMillis) {
            self.timestamp = isoTimestampFromMilliseconds(timestampMillis)
        } else {
            throw DecodingError.keyNotFound(
                CodingKeys.timestamp,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "AI chat message timestamp is missing."
                )
            )
        }
        self.isError = try container.decode(Bool.self, forKey: .isError)
        self.isStopped = try container.decodeIfPresent(Bool.self, forKey: .isStopped) ?? false
        self.cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        self.itemId = try container.decodeIfPresent(String.self, forKey: .itemId)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.id, forKey: .id)
        try container.encode(self.role, forKey: .role)
        try container.encode(self.content, forKey: .content)
        try container.encode(self.timestamp, forKey: .timestamp)
        try container.encode(self.isError, forKey: .isError)
        try container.encode(self.isStopped, forKey: .isStopped)
        try container.encodeIfPresent(self.cursor, forKey: .cursor)
        try container.encodeIfPresent(self.itemId, forKey: .itemId)
    }
}

struct AIChatPersistedState: Codable, Hashable, Sendable {
    let messages: [AIChatMessage]
    let chatSessionId: String
    let lastKnownChatConfig: AIChatServerConfig?

    init(
        messages: [AIChatMessage],
        chatSessionId: String,
        lastKnownChatConfig: AIChatServerConfig?
    ) {
        self.messages = messages
        self.chatSessionId = chatSessionId
        self.lastKnownChatConfig = lastKnownChatConfig
    }

    init(messages: [AIChatMessage]) {
        self.init(
            messages: messages,
            chatSessionId: "",
            lastKnownChatConfig: nil
        )
    }
}

func isoTimestampFromMilliseconds(_ value: Int) -> String {
    let date = Date(timeIntervalSince1970: TimeInterval(value) / 1000)
    return isoTimestampFromDate(date)
}

private func isoTimestampFromDate(_ value: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: value)
}
