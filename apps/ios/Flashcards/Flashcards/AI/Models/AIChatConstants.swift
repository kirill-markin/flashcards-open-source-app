import Foundation

let aiChatClientPlatform: String = "ios"
/// Identifies this app process on every live attach, including resumes. The backend ends an older
/// attach only when the same id attaches again, so a per-request id would supersede the connection
/// that is opening.
let aiChatLiveClientId: String = UUID().uuidString.lowercased()
let aiChatCreateCardDraftPrompt: String = "Help me create a card."
let aiChatExternalProviderConsentUserDefaultsKey: String = "ai-chat-external-provider-consent"
let aiChatExternalProviderConsentRequiredMessage: String = "Review AI data use and accept it on this device before using AI features."
let aiChatAccuracyWarningText: String = "AI responses can be inaccurate or incomplete. Review important results before relying on them."
let aiChatGuestQuotaButtonTitle: String = "Create account or Log in"
/// The backend's upload limits in `apps/backend/src/chatFiles/uploads.ts`; the attachment error copy in every
/// `AISettings.strings` states these numbers.
let aiChatMaximumFileAttachmentBytes: Int = 30 * 1024 * 1024
let aiChatMaximumImageAttachmentBytes: Int = 10 * 1024 * 1024
let aiChatMaximumTurnImageAttachmentBytes: Int = 15 * 1024 * 1024
let aiChatMaximumUploadsPerTurn: Int = 10
let aiChatMaximumStartRunRequestBytes: Int = 5 * 1024 * 1024
let aiChatLocalSessionStalenessThreshold: TimeInterval = 6 * 60 * 60
let aiChatSessionHistoryPageLimit: Int = 20
/// Server limits for the history search `q` and for a chat title, both counted in code points after trimming.
let aiChatSessionHistorySearchMaximumLength: Int = 200
let aiChatSessionTitleMaximumLength: Int = 200
let aiChatSupportedFileExtensions: Set<String> = [
    "pdf",
    "txt",
    "csv",
    "json",
    "xml",
    "xlsx",
    "xls",
    "md",
    "html",
    "py",
    "js",
    "ts",
    "yaml",
    "yml",
    "sql",
    "log",
    "docx",
    "zip",
    "apkg",
]
let aiChatExternalProviderDisclosureItems: [String] = [
    "Typed prompts and card-derived context needed for your request can be sent to the hosted AI service.",
    "Uploaded files and images can be sent to the hosted AI service for AI processing.",
    "Dictated audio and transcription requests can be sent to the hosted AI service for speech processing.",
    "Technical diagnostics about failed or slow AI requests can be sent to help debug the hosted AI service.",
]
