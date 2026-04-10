package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.core.ui.bidiWrap

fun formatAiConsentWorkspaceDisclosureText(
    template: String,
    currentWorkspaceName: String
): String {
    return template.format(bidiWrap(text = currentWorkspaceName))
}
