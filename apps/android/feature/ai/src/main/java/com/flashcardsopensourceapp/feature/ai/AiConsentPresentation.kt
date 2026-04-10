package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.core.ui.bidiWrap
import java.util.Locale

fun formatAiConsentWorkspaceDisclosureText(
    template: String,
    currentWorkspaceName: String,
    locale: Locale
): String {
    return template.format(
        bidiWrap(
            text = currentWorkspaceName,
            locale = locale
        )
    )
}
