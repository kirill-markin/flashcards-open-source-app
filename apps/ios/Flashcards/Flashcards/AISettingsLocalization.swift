import Foundation

private let aiSettingsLocalizationTable: String = "AISettings"

func aiSettingsLocalized(_ key: String, _ defaultValue: String) -> String {
    Bundle.main.localizedString(
        forKey: key,
        value: defaultValue,
        table: aiSettingsLocalizationTable
    )
}

func aiSettingsLocalizedFormat(_ key: String, _ defaultValue: String, _ arguments: CVarArg...) -> String {
    let format = aiSettingsLocalized(key, defaultValue)
    return String(format: format, locale: Locale.current, arguments: arguments)
}

func localizedAIChatDisclosureItem(_ item: String) -> String {
    switch item {
    case "Typed prompts and card-derived context needed for your request can be sent to OpenAI.":
        return aiSettingsLocalized(
            "ai.consent.disclosure.prompts",
            "Typed prompts and card-derived context needed for your request can be sent to OpenAI."
        )
    case "Uploaded files and images can be uploaded to OpenAI for AI processing.":
        return aiSettingsLocalized(
            "ai.consent.disclosure.files",
            "Uploaded files and images can be uploaded to OpenAI for AI processing."
        )
    case "Dictated audio and transcription requests can be sent to OpenAI for speech processing.":
        return aiSettingsLocalized(
            "ai.consent.disclosure.audio",
            "Dictated audio and transcription requests can be sent to OpenAI for speech processing."
        )
    case "Technical diagnostics about failed or slow AI requests can be sent to help debug the hosted AI service.":
        return aiSettingsLocalized(
            "ai.consent.disclosure.diagnostics",
            "Technical diagnostics about failed or slow AI requests can be sent to help debug the hosted AI service."
        )
    default:
        return item
    }
}

func localizedAIChatAccuracyWarningText(_ text: String) -> String {
    guard text == aiChatAccuracyWarningText else {
        return text
    }

    return aiSettingsLocalized(
        "ai.warning.accuracy",
        "AI responses can be inaccurate or incomplete. Review important results before relying on them."
    )
}

func localizedCloudAccountStateTitle(_ cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .disconnected:
        return aiSettingsLocalized("cloud.state.disconnected", "Disconnected")
    case .linkingReady:
        return aiSettingsLocalized("cloud.state.linkingReady", "Linking ready")
    case .guest:
        return aiSettingsLocalized("cloud.state.guest", "Guest")
    case .linked:
        return aiSettingsLocalized("cloud.state.linked", "Linked")
    }
}

func localizedAccessPermissionKindTitle(_ kind: AccessPermissionKind) -> String {
    switch kind {
    case .photos:
        return aiSettingsLocalized("settings.access.kind.photos", "Photos")
    case .camera:
        return aiSettingsLocalized("settings.access.kind.camera", "Camera")
    case .microphone:
        return aiSettingsLocalized("settings.access.kind.microphone", "Microphone")
    }
}

func localizedAccessPermissionDescription(_ kind: AccessPermissionKind) -> String {
    switch kind {
    case .photos:
        return aiSettingsLocalized("settings.access.description.photos", "Choose photos for AI chat attachments.")
    case .camera:
        return aiSettingsLocalized("settings.access.description.camera", "Take photos directly from AI chat.")
    case .microphone:
        return aiSettingsLocalized("settings.access.description.microphone", "Dictate text into AI chat.")
    }
}

func localizedAccessPermissionStatusTitle(_ status: AccessPermissionStatus) -> String {
    switch status {
    case .allowed:
        return aiSettingsLocalized("settings.access.status.allowed", "Allowed")
    case .askEveryTime:
        return aiSettingsLocalized("settings.access.status.askEveryTime", "Ask every time")
    case .blocked:
        return aiSettingsLocalized("settings.access.status.blocked", "Blocked")
    case .limited:
        return aiSettingsLocalized("settings.access.status.limited", "Limited")
    case .unavailable:
        return aiSettingsLocalized("settings.access.status.unavailable", "Unavailable")
    }
}

func localizedAccessPermissionPrimaryActionTitle(_ status: AccessPermissionStatus) -> String? {
    switch status {
    case .askEveryTime:
        return aiSettingsLocalized("settings.access.action.request", "Request access")
    case .allowed, .blocked, .limited:
        return aiSettingsLocalized("settings.access.action.openSettings", "Open Settings")
    case .unavailable:
        return nil
    }
}

func localizedAccessPermissionGuidance(kind: AccessPermissionKind, status: AccessPermissionStatus) -> String {
    switch (kind, status) {
    case (.photos, .limited):
        return aiSettingsLocalized(
            "settings.access.guidance.photos.limited",
            "Only the photos you already shared with Flashcards Open Source App are available. Open Settings to grant broader photo access."
        )
    case (.photos, .blocked):
        return aiSettingsLocalized(
            "settings.access.guidance.photos.blocked",
            "Photo access is turned off for Flashcards Open Source App. Open Settings > Privacy & Security > Photos to change it."
        )
    case (.camera, .blocked):
        return aiSettingsLocalized(
            "settings.access.guidance.camera.blocked",
            "Camera access is turned off for Flashcards Open Source App. Open Settings > Privacy & Security > Camera to change it."
        )
    case (.microphone, .blocked):
        return aiSettingsLocalized(
            "settings.access.guidance.microphone.blocked",
            "Microphone access is turned off for Flashcards Open Source App. Open Settings > Privacy & Security > Microphone to change it."
        )
    case (_, .askEveryTime):
        return aiSettingsLocalized(
            "settings.access.guidance.askEveryTime",
            "Request access now, or open Settings later if you want to manage it manually."
        )
    case (_, .allowed):
        return aiSettingsLocalized(
            "settings.access.guidance.allowed",
            "Open Settings if you want to turn this access off."
        )
    case (_, .limited):
        return aiSettingsLocalized(
            "settings.access.guidance.limited",
            "Open Settings to review or expand this access."
        )
    case (_, .unavailable):
        return aiSettingsLocalized(
            "settings.access.guidance.unavailable",
            "This access is unavailable on the current device."
        )
    }
}

func localizedReviewNotificationPermissionStatusTitle(_ status: ReviewNotificationPermissionStatus) -> String {
    switch status {
    case .allowed:
        return aiSettingsLocalized("settings.notifications.permission.allowed", "Allowed")
    case .notRequested:
        return aiSettingsLocalized("settings.notifications.permission.notRequested", "Not requested")
    case .blocked:
        return aiSettingsLocalized("settings.notifications.permission.blocked", "Blocked")
    }
}

func localizedReviewNotificationPermissionActionTitle(_ status: ReviewNotificationPermissionStatus) -> String {
    switch status {
    case .allowed, .blocked:
        return aiSettingsLocalized("settings.notifications.permission.action.openSettings", "Open Settings")
    case .notRequested:
        return aiSettingsLocalized("settings.notifications.permission.action.allow", "Allow Notifications")
    }
}

func localizedReviewNotificationModeTitle(_ mode: ReviewNotificationMode) -> String {
    switch mode {
    case .daily:
        return aiSettingsLocalized("settings.notifications.mode.daily", "Daily")
    case .inactivity:
        return aiSettingsLocalized("settings.notifications.mode.inactivity", "Inactivity")
    }
}

func localizedAIAttachmentMenuActionTitle(_ action: AIChatAttachmentMenuAction) -> String {
    switch action {
    case .takePhoto:
        return aiSettingsLocalized("ai.composer.attachment.takePhoto", "Take Photo")
    case .choosePhoto:
        return aiSettingsLocalized("ai.composer.attachment.choosePhoto", "Choose Photo")
    case .chooseFile:
        return aiSettingsLocalized("ai.composer.attachment.chooseFile", "Choose File")
    }
}
