package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsUiState
import com.flashcardsopensourceapp.feature.settings.settingsAccessRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAgentConnectionsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDecksRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteAccountRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeviceDiagnosticsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsExportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsFeedbackRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLanguageRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLegalSupportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsOpenSourceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsResetStudyProgressRowTag
import com.flashcardsopensourceapp.feature.settings.settingsReviewRemindersRowTag
import com.flashcardsopensourceapp.feature.settings.settingsSchedulingRowTag
import com.flashcardsopensourceapp.feature.settings.settingsServerRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTagsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTestRowTag
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsRootRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun rootRowsMatchSharedInformationArchitectureWithoutTestMode() {
        val clickedRows = mutableListOf<String>()

        renderSettingsRoute(
            isTestModeEnabled = false,
            clickedRows = clickedRows
        )

        listOf(
            settingsString(SettingsR.string.settings_section_account),
            settingsString(SettingsR.string.settings_section_general),
            settingsString(SettingsR.string.settings_section_support),
            settingsString(SettingsR.string.settings_section_advanced)
        ).forEach { sectionTitle ->
            assertSectionLabel(sectionTitle = sectionTitle)
        }

        listOf(
            settingsAccountStatusRowTag,
            settingsCurrentWorkspaceRowTag,
            settingsReviewRemindersRowTag,
            settingsLanguageRowTag,
            settingsAccessRowTag,
            settingsDecksRowTag,
            settingsTagsRowTag,
            settingsExportRowTag,
            settingsFeedbackRowTag,
            settingsLegalSupportRowTag,
            settingsOpenSourceRowTag,
            settingsSchedulingRowTag,
            settingsAgentConnectionsRowTag,
            settingsServerRowTag,
            settingsDeviceDiagnosticsRowTag,
            settingsResetStudyProgressRowTag,
            settingsDeleteCurrentWorkspaceRowTag,
            settingsDeleteAccountRowTag
        ).forEach { rowTag ->
            assertRootRowVisible(rowTag = rowTag)
        }
        composeRule.onAllNodesWithTag(settingsTestRowTag).assertCountEquals(0)

        assertRowClick(
            rowTag = settingsAccountStatusRowTag,
            expectedClick = "account_status",
            clickedRows = clickedRows
        )
        assertRowClick(
            rowTag = settingsCurrentWorkspaceRowTag,
            expectedClick = "current_workspace",
            clickedRows = clickedRows
        )
        assertRowClick(
            rowTag = settingsLanguageRowTag,
            expectedClick = "language",
            clickedRows = clickedRows
        )
        assertRowClick(
            rowTag = settingsSchedulingRowTag,
            expectedClick = "scheduling",
            clickedRows = clickedRows
        )
        assertRowClick(
            rowTag = settingsServerRowTag,
            expectedClick = "server",
            clickedRows = clickedRows
        )
        assertRowClick(
            rowTag = settingsDeleteAccountRowTag,
            expectedClick = "delete_account",
            clickedRows = clickedRows
        )
    }

    @Test
    fun testRowIsVisibleWhenTestModeIsEnabled() {
        val clickedRows = mutableListOf<String>()

        renderSettingsRoute(
            isTestModeEnabled = true,
            clickedRows = clickedRows
        )

        assertSectionLabel(sectionTitle = settingsString(SettingsR.string.settings_section_advanced))
        assertRootRowVisible(rowTag = settingsTestRowTag)
        assertRowClick(
            rowTag = settingsTestRowTag,
            expectedClick = "test",
            clickedRows = clickedRows
        )
    }

    private fun renderSettingsRoute(
        isTestModeEnabled: Boolean,
        clickedRows: MutableList<String>
    ) {
        composeRule.setContent {
            FlashcardsTheme {
                SettingsRoute(
                    uiState = SettingsUiState(
                        currentWorkspaceName = "Personal",
                        workspaceName = "Personal",
                        cardCount = 0,
                        deckCount = 0,
                        storageLabel = "Room + SQLite",
                        syncStatusText = "Local",
                        accountStatusTitle = "Not signed in",
                        isTestModeEnabled = isTestModeEnabled
                    ),
                    onOpenAccountStatus = {
                        clickedRows += "account_status"
                    },
                    onOpenCurrentWorkspace = {
                        clickedRows += "current_workspace"
                    },
                    onOpenReviewReminders = {
                        clickedRows += "review_reminders"
                    },
                    onOpenLanguage = {
                        clickedRows += "language"
                    },
                    onOpenAccess = {
                        clickedRows += "access"
                    },
                    onOpenDecks = {
                        clickedRows += "decks"
                    },
                    onOpenTags = {
                        clickedRows += "tags"
                    },
                    onOpenExport = {
                        clickedRows += "export"
                    },
                    onOpenFeedback = {
                        clickedRows += "feedback"
                    },
                    onOpenLegalSupport = {
                        clickedRows += "legal_support"
                    },
                    onOpenOpenSource = {
                        clickedRows += "open_source"
                    },
                    onOpenScheduling = {
                        clickedRows += "scheduling"
                    },
                    onOpenAgentConnections = {
                        clickedRows += "agent_connections"
                    },
                    onOpenServer = {
                        clickedRows += "server"
                    },
                    onOpenDeviceDiagnostics = {
                        clickedRows += "device_diagnostics"
                    },
                    onOpenResetStudyProgress = {
                        clickedRows += "reset_study_progress"
                    },
                    onOpenDeleteCurrentWorkspace = {
                        clickedRows += "delete_current_workspace"
                    },
                    onOpenDeleteAccount = {
                        clickedRows += "delete_account"
                    },
                    onOpenTest = {
                        clickedRows += "test"
                    }
                )
            }
        }
    }

    private fun assertSectionLabel(sectionTitle: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasText(sectionTitle))
        composeRule.onNodeWithText(sectionTitle).assertIsDisplayed()
        composeRule.onNodeWithText(sectionTitle).assert(hasNoClickAction())
    }

    private fun assertRootRowVisible(rowTag: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasTestTag(rowTag))
        composeRule.onNodeWithTag(rowTag).assertIsDisplayed()
    }

    private fun assertRowClick(
        rowTag: String,
        expectedClick: String,
        clickedRows: MutableList<String>
    ) {
        assertRootRowVisible(rowTag = rowTag)
        composeRule.onNodeWithTag(rowTag).performClick()
        assertEquals(expectedClick, clickedRows.last())
    }

    private fun hasNoClickAction(): SemanticsMatcher {
        return SemanticsMatcher(description = "has no click action") { node ->
            node.config.getOrNull(SemanticsActions.OnClick) == null
        }
    }

    private fun settingsString(@StringRes resId: Int): String {
        return composeRule.activity.getString(resId)
    }
}
