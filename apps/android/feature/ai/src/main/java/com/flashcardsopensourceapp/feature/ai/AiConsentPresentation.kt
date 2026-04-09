package com.flashcardsopensourceapp.feature.ai

fun formatAiConsentWorkspaceDisclosureText(
    template: String,
    currentWorkspaceName: String
): String {
    return template.format(currentWorkspaceName)
}
