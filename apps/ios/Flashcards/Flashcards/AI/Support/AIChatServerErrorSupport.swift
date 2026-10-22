import Foundation

enum AIChatErrorSurface {
    case chat
    case dictation
}

private let aiChatAvailabilityErrorCodes: Set<String> = [
    "LOCAL_CHAT_NOT_CONFIGURED",
    "LOCAL_CHAT_UNAVAILABLE",
    "LOCAL_CHAT_CONTINUATION_FAILED",
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
            return aiSettingsLocalized(
                "ai.availability.chat.official",
                "AI is temporarily unavailable on the official server. Try again later."
            )
        case .custom:
            return aiSettingsLocalized(
                "ai.availability.chat.custom",
                "AI is unavailable on this server. Contact the server operator."
            )
        }
    case .dictation:
        guard aiChatDictationAvailabilityErrorCodes.contains(code) else {
            return nil
        }

        switch configurationMode {
        case .official:
            return aiSettingsLocalized(
                "ai.availability.dictation.official",
                "AI dictation is temporarily unavailable on the official server. Try again later."
            )
        case .custom:
            return aiSettingsLocalized(
                "ai.availability.dictation.custom",
                "AI dictation is unavailable on this server. Contact the server operator."
            )
        }
    }
}

func isAIChatAvailabilityErrorCode(code: String, surface: AIChatErrorSurface) -> Bool {
    switch surface {
    case .chat:
        return aiChatAvailabilityErrorCodes.contains(code)
    case .dictation:
        return aiChatDictationAvailabilityErrorCodes.contains(code)
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

/// Client copy for the stable code of a run's terminal error message; nil for an absent or unknown code, whose stored text is shown instead.
func aiChatTerminalErrorMessage(errorCode: String?) -> String? {
    guard let errorCode else {
        return nil
    }

    switch errorCode {
    case "CHAT_RUN_DEADLINE_REACHED":
        return aiSettingsLocalized(
            "ai.error.terminal.deadlineReached",
            "This took too long, so I stopped. Everything already saved is kept. Write \"continue\" to finish the rest."
        )
    case "CHAT_RUN_INTERRUPTED":
        return aiSettingsLocalized(
            "ai.error.terminal.interrupted",
            "The AI response was interrupted before it finished. Please try again."
        )
    case "CHAT_RUNTIME_ERROR":
        return aiSettingsLocalized(
            "ai.error.terminal.runtimeError",
            "The AI response failed before it could finish. Please try again."
        )
    case "CHAT_PROVIDER_ERROR":
        return aiSettingsLocalized(
            "ai.error.terminal.providerError",
            "The AI service could not complete the response. Please try again."
        )
    case "CHAT_PROVIDER_AUTH_FAILED":
        return aiSettingsLocalized(
            "ai.error.terminal.providerAuthFailed",
            "The AI service could not authenticate the request. Please try again later."
        )
    case "CHAT_PROVIDER_RATE_LIMITED":
        return aiSettingsLocalized(
            "ai.error.terminal.providerRateLimited",
            "The AI service is rate limited right now. Please try again in a few minutes."
        )
    case "CHAT_PROVIDER_UNAVAILABLE":
        return aiSettingsLocalized(
            "ai.error.terminal.providerUnavailable",
            "The AI service is temporarily unavailable. Please try again soon."
        )
    case "CHAT_PROVIDER_ABORTED":
        return aiSettingsLocalized(
            "ai.error.terminal.providerAborted",
            "The AI request was interrupted. Please try again."
        )
    case "CHAT_CONTEXT_LENGTH_EXCEEDED":
        return aiSettingsLocalized(
            "ai.error.terminal.contextLengthExceeded",
            "This conversation has grown too long for the AI to continue. Please start a new chat to keep going."
        )
    case "CHAT_ATTACHMENT_UNSUPPORTED_TYPE":
        return aiChatAttachmentUnsupportedTypeMessage()
    case "AI_CONSENT_REQUIRED":
        return aiSettingsLocalized(
            "ai.error.terminal.consentRequired",
            "AI consent was withdrawn or superseded. Review the disclosure and grant consent before sending another message."
        )
    case "OPENAI_API_KEY_INVALID":
        return aiSettingsLocalized(
            "ai.error.terminal.ownOpenAIKeyInvalid",
            "Your OpenAI key does not work. Check it in Settings."
        )
    default:
        return nil
    }
}
