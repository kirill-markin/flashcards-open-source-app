package com.flashcardsopensourceapp.app.routes

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
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
import com.flashcardsopensourceapp.feature.settings.SettingsFriendInviteAvailability
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsUiState
import com.flashcardsopensourceapp.feature.settings.TestSettingsRoute
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
import com.flashcardsopensourceapp.feature.settings.settingsInviteFriendButtonTag
import com.flashcardsopensourceapp.feature.settings.settingsLanguageRowTag
import com.flashcardsopensourceapp.feature.settings.settingsLeaderboardParticipationRowTag
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
import com.flashcardsopensourceapp.feature.settings.testSettingsAnimationsRowTag
import com.flashcardsopensourceapp.feature.settings.testSettingsNotificationDiagnosticsRowTag
import com.flashcardsopensourceapp.feature.settings.testSettingsScreenTag
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
            friendInviteAvailability = SettingsFriendInviteAvailability.AVAILABLE,
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
            settingsInviteFriendButtonTag,
            settingsAccountStatusRowTag,
            settingsCurrentWorkspaceRowTag,
            settingsReviewRemindersRowTag,
            settingsReviewAnimationsRowTag,
            settingsLeaderboardParticipationRowTag,
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
            firstRowTag = settingsInviteFriendButtonTag,
            secondRowTag = settingsAccountSectionTag
        )
        assertRootRowOrder(
            firstRowTag = settingsReviewRemindersRowTag,
            secondRowTag = settingsReviewAnimationsRowTag
        )
        assertRootRowOrder(
            firstRowTag = settingsReviewAnimationsRowTag,
            secondRowTag = settingsLeaderboardParticipationRowTag
        )
        assertRootRowOrder(
            firstRowTag = settingsLeaderboardParticipationRowTag,
            secondRowTag = settingsLanguageRowTag
        )
        assertRootRowOrder(
            firstRowTag = settingsSupportRowTag,
            secondRowTag = settingsLegalRowTag
        )
        composeRule.onAllNodesWithTag(settingsTestRowTag).assertCountEquals(0)

        assertRowClick(
            rowTag = settingsInviteFriendButtonTag,
            expectedClick = "friend_invite",
            clickedRows = clickedRows
        )
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
            rowTag = settingsLeaderboardParticipationRowTag,
            expectedClick = "leaderboard_participation",
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
            friendInviteAvailability = SettingsFriendInviteAvailability.AVAILABLE,
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
    fun testSettingsRowsOpenDiagnosticTools() {
        val clickedRows = mutableListOf<String>()

        composeRule.setContent {
            FlashcardsTheme {
                TestSettingsRoute(
                    onOpenAnimations = {
                        clickedRows += "animations"
                    },
                    onOpenNotificationDiagnostics = {
                        clickedRows += "notification_diagnostics"
                    },
                    onBack = {
                        clickedRows += "back"
                    }
                )
            }
        }

        assertTestSettingsRowVisible(rowTag = testSettingsAnimationsRowTag)
        assertTestSettingsRowVisible(rowTag = testSettingsNotificationDiagnosticsRowTag)
        assertTestSettingsRowClick(
            rowTag = testSettingsNotificationDiagnosticsRowTag,
            expectedClick = "notification_diagnostics",
            clickedRows = clickedRows
        )
    }

    @Test
    fun reviewAnimationsRowIsHiddenWhenAccountPreferencesCannotBeManaged() {
        renderSettingsRoute(
            isTestModeEnabled = false,
            canManageAccountPreferences = false,
            friendInviteAvailability = SettingsFriendInviteAvailability.SIGN_IN_REQUIRED,
            clickedRows = mutableListOf()
        )

        composeRule.onAllNodesWithTag(settingsReviewAnimationsRowTag).assertCountEquals(0)
    }

    @Test
    fun inviteButtonIsDisabledWhileAccountStateLoads() {
        renderSettingsRoute(
            isTestModeEnabled = false,
            canManageAccountPreferences = false,
            friendInviteAvailability = SettingsFriendInviteAvailability.LOADING,
            clickedRows = mutableListOf()
        )

        assertRootRowVisible(rowTag = settingsInviteFriendButtonTag)
        composeRule.onNodeWithTag(settingsInviteFriendButtonTag).assertIsNotEnabled()
    }

    private fun renderSettingsRoute(
        isTestModeEnabled: Boolean,
        canManageAccountPreferences: Boolean,
        friendInviteAvailability: SettingsFriendInviteAvailability,
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
                        friendInviteAvailability = friendInviteAvailability,
                        reviewReactionAnimationsEnabled = true,
                        canManageAccountPreferences = canManageAccountPreferences,
                        isTestModeEnabled = isTestModeEnabled
                    ),
                    onOpenFriendInvite = {
                        clickedRows += "friend_invite"
                    },
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
                    onOpenLeaderboardParticipation = {
                        clickedRows += "leaderboard_participation"
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

    private fun assertTestSettingsRowVisible(rowTag: String) {
        composeRule.onNodeWithTag(testTag = testSettingsScreenTag)
            .performScrollToNode(matcher = hasTestTag(rowTag))
        composeRule.onNodeWithTag(rowTag).assertIsDisplayed()
    }

    private fun assertTestSettingsRowClick(
        rowTag: String,
        expectedClick: String,
        clickedRows: MutableList<String>
    ) {
        assertTestSettingsRowVisible(rowTag = rowTag)
        composeRule.onNodeWithTag(rowTag).performClick()
        assertEquals(expectedClick, clickedRows.last())
    }

}
