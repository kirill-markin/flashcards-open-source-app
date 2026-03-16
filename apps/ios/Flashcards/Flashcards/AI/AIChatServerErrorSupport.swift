import Foundation

enum AIChatErrorSurface {
    case chat
    case dictation
}

private let aiChatAvailabilityErrorCodes: Set<String> = [
    "LOCAL_CHAT_NOT_CONFIGURED",
    "LOCAL_CHAT_UNAVAILABLE",
    "LOCAL_CHAT_RATE_LIMITED",
    "LOCAL_CHAT_PROVIDER_AUTH_FAILED",
]

private let aiChatDictationAvailabilityErrorCodes: Set<String> = [
    "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
    "CHAT_TRANSCRIPTION_UNAVAILABLE",
    "CHAT_TRANSCRIPTION_RATE_LIMITED",
    "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED",
]

/**
 Maps stable backend AI availability codes to mode-aware client copy.

 The official backend is presented as a first-party service that may recover on
 its own, while custom servers are presented as operator-managed deployments.
 */
func aiChatAvailabilityMessage(
    code: String,
    configurationMode: CloudServiceConfigurationMode,
    surface: AIChatErrorSurface
) -> String? {
    switch surface {
    case .chat:
        guard aiChatAvailabilityErrorCodes.contains(code) else {
            return nil
        }

        switch configurationMode {
        case .official:
            return "AI is temporarily unavailable on the official server. Try again later."
        case .custom:
            return "AI is unavailable on this server. Contact the server operator."
        }
    case .dictation:
        guard aiChatDictationAvailabilityErrorCodes.contains(code) else {
            return nil
        }

        switch configurationMode {
        case .official:
            return "AI dictation is temporarily unavailable on the official server. Try again later."
        case .custom:
            return "AI dictation is unavailable on this server. Contact the server operator."
        }
    }
}

/**
 Converts backend error payloads into user-facing text while keeping request
 references intact for support and debugging. Known availability codes always
 override raw backend strings so provider details never leak into the UI.
 */
func makeAIChatUserFacingErrorMessage(
    rawMessage: String,
    code: String?,
    requestId: String?,
    configurationMode: CloudServiceConfigurationMode,
    surface: AIChatErrorSurface
) -> String {
    if let code, let mappedMessage = aiChatAvailabilityMessage(
        code: code,
        configurationMode: configurationMode,
        surface: surface
    ) {
        return appendCloudRequestIdReference(message: mappedMessage, requestId: requestId)
    }

    return appendCloudRequestIdReference(message: rawMessage, requestId: requestId)
}
