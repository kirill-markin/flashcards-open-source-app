package com.flashcardsopensourceapp.feature.ai

fun formatAiConsentWorkspaceDisclosureText(currentWorkspaceName: String): String {
    return "AI requests from the \"$currentWorkspaceName\" workspace can send prompts, uploaded files, images, and dictated audio to external providers."
}
