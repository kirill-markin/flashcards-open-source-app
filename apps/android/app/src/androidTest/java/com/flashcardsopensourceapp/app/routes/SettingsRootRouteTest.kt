package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsUiState
import com.flashcardsopensourceapp.feature.settings.settingsAccessRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountStatusRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAgentConnectionsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsAccountSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsAdvancedSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDecksRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteAccountRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeleteCurrentWorkspaceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsDeviceDiagnosticsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsExportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsFeedbackRowTag
import com.flashcardsopensourceapp.feature.settings.settingsGeneralSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsLanguageRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLegalRowTag
import com.flashcardsopensourceapp.feature.settings.settingsOpenSourceRowTag
import com.flashcardsopensourceapp.feature.settings.settingsResetStudyProgressRowTag
import com.flashcardsopensourceapp.feature.settings.settingsReviewAnimationsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsReviewRemindersRowTag
import com.flashcardsopensourceapp.feature.settings.settingsRootScreenTag
import com.flashcardsopensourceapp.feature.settings.settingsSchedulingRowTag
import com.flashcardsopensourceapp.feature.settings.settingsServerRowTag
import com.flashcardsopensourceapp.feature.settings.settingsSupportSectionTag
import com.flashcardsopensourceapp.feature.settings.settingsSupportRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTagsRowTag
import com.flashcardsopensourceapp.feature.settings.settingsTestRowTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
            canManageAccountPreferences = true,
            clickedRows = clickedRows
        )

        listOf(
            settingsAccountSectionTag,
            settingsGeneralSectionTag,
            settingsSupportSectionTag,
            settingsAdvancedSectionTag
        ).forEach { sectionTag ->
            assertSectionVisible(sectionTag = sectionTag)
        }

        listOf(
            settingsAccountStatusRowTag,
            settingsCurrentWorkspaceRowTag,
            settingsReviewRemindersRowTag,
            settingsReviewAnimationsRowTag,
            settingsLanguageRowTag,
            settingsAccessRowTag,
            settingsDecksRowTag,
            settingsTagsRowTag,
            settingsExportRowTag,
            settingsFeedbackRowTag,
            settingsSupportRowTag,
            settingsLegalRowTag,
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
        assertRootRowOrder(
            firstRowTag = settingsReviewRemindersRowTag,
            secondRowTag = settingsReviewAnimationsRowTag
        )
        assertRootRowOrder(
            firstRowTag = settingsReviewAnimationsRowTag,
            secondRowTag = settingsLanguageRowTag
        )
        assertRootRowOrder(
            firstRowTag = settingsSupportRowTag,
            secondRowTag = settingsLegalRowTag
        )
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
            rowTag = settingsReviewAnimationsRowTag,
            expectedClick = "review_animations",
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
            canManageAccountPreferences = true,
            clickedRows = clickedRows
        )

        assertSectionVisible(sectionTag = settingsAdvancedSectionTag)
        assertRootRowVisible(rowTag = settingsTestRowTag)
        assertRowClick(
            rowTag = settingsTestRowTag,
            expectedClick = "test",
            clickedRows = clickedRows
        )
    }

    @Test
    fun reviewAnimationsRowIsHiddenWhenAccountPreferencesCannotBeManaged() {
        renderSettingsRoute(
            isTestModeEnabled = false,
            canManageAccountPreferences = false,
            clickedRows = mutableListOf()
        )

        composeRule.onAllNodesWithTag(settingsReviewAnimationsRowTag).assertCountEquals(0)
    }

    private fun renderSettingsRoute(
        isTestModeEnabled: Boolean,
        canManageAccountPreferences: Boolean,
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
                        accountStatusAttentionCount = 0,
                        reviewReactionAnimationsEnabled = true,
                        canManageAccountPreferences = canManageAccountPreferences,
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
                    onOpenReviewAnimations = {
                        clickedRows += "review_animations"
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
                    onOpenLegal = {
                        clickedRows += "legal_support"
                    },
                    onOpenSupport = {
                        clickedRows += "support"
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

    private fun assertSectionVisible(sectionTag: String) {
        composeRule.onNodeWithTag(testTag = settingsRootScreenTag)
            .performScrollToNode(matcher = hasTestTag(sectionTag))
        composeRule.onNodeWithTag(sectionTag).assertIsDisplayed()
    }

    private fun assertRootRowVisible(rowTag: String) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasTestTag(rowTag))
        composeRule.onNodeWithTag(rowTag).assertIsDisplayed()
    }

    private fun assertRootRowOrder(
        firstRowTag: String,
        secondRowTag: String
    ) {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(matcher = hasTestTag(firstRowTag))
        composeRule.onNodeWithTag(firstRowTag).assertIsDisplayed()
        composeRule.onNodeWithTag(secondRowTag).assertIsDisplayed()
        val firstTop = composeRule.onNodeWithTag(firstRowTag).fetchSemanticsNode().boundsInRoot.top
        val secondTop = composeRule.onNodeWithTag(secondRowTag).fetchSemanticsNode().boundsInRoot.top
        assertTrue("$firstRowTag should appear before $secondRowTag", firstTop < secondTop)
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

}
