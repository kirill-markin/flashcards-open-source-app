import Foundation

let aiChatDefaultModelId: String = "gpt-5.4"
let aiChatDefaultModelLabel: String = "GPT-5.4"
let aiChatDefaultProviderLabel: String = "OpenAI"
let aiChatDefaultReasoningEffort: String = "medium"
let aiChatDefaultReasoningLabel: String = "Medium"
let aiChatClientPlatform: String = "ios"
let aiChatCreateCardDraftPrompt: String = "Help me create a card."
let aiChatExternalProviderConsentUserDefaultsKey: String = "ai-chat-external-provider-consent"
let aiChatExternalProviderConsentRequiredMessage: String = "Review AI data use and accept it on this device before using AI features."
let aiChatAccuracyWarningText: String = "AI responses can be inaccurate or incomplete. Review important results before relying on them."
let aiChatGuestQuotaReachedMessage: String = "Your free guest AI limit for this month is used up. Create an account or log in to keep using AI."
let aiChatGuestQuotaButtonTitle: String = "Create account or Log in"
let aiChatMaximumAttachmentBytes: Int = 20 * 1024 * 1024
let aiChatLocalSessionStalenessThreshold: TimeInterval = 6 * 60 * 60
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
]
let aiChatToolNames: Set<String> = [
    "sql",
]
let aiChatExternalProviderDisclosureItems: [String] = [
    "Typed prompts and card-derived context needed for your request can be sent to OpenAI.",
    "Uploaded files and images can be uploaded to OpenAI for AI processing.",
    "Dictated audio and transcription requests can be sent to OpenAI for speech processing.",
    "Technical diagnostics about failed or slow AI requests can be sent to help debug the hosted AI service.",
]
