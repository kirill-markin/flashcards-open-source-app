package com.flashcardsopensourceapp.app.livesmoke.support

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.tapBackIcon
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitUntilAtLeastOneExistsOrFail
import com.flashcardsopensourceapp.app.livesmoke.flows.openSettingsRow
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsRootScreenTag

internal fun LiveSmokeContext.assertLinkedAccountStatus(
    reviewEmail: String,
    workspaceName: String
) {
    openSettingsRow(rowTag = settingsAccountStatusRowTag, rowLabel = "Account status")
    waitUntilAtLeastOneExistsOrFail(
        matcher = hasText(reviewEmail),
        timeoutMillis = internalUiTimeoutMillis
    )
    composeRule.onNodeWithText("Linked").fetchSemanticsNode()
    tapBackIcon()
    composeRule.onNodeWithTag(settingsRootScreenTag)
        .performScrollToNode(matcher = hasTestTag(settingsCurrentWorkspaceRowTag))
    composeRule.onNodeWithTag(settingsCurrentWorkspaceRowTag).fetchSemanticsNode()
    composeRule.onNodeWithText(workspaceName).fetchSemanticsNode()
}
