package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.AgentConnectionItemUiState
import com.flashcardsopensourceapp.feature.settings.AgentConnectionsRoute
import com.flashcardsopensourceapp.feature.settings.AgentConnectionsUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AgentConnectionsRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun unlinkedStateShowsSignInGuidanceWithoutReloading() {
        var reloadCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                AgentConnectionsRoute(
                    uiState = AgentConnectionsUiState(
                        isLinked = false,
                        isLoading = false,
                        instructions = "",
                        errorMessage = "",
                        revokingConnectionId = null,
                        connections = emptyList()
                    ),
                    onReload = {
                        reloadCalls += 1
                    },
                    onRevokeConnection = {},
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText(
            "Sign in to the cloud account to manage long-lived bot connections."
        ).assertIsDisplayed()
        assertEquals(0, reloadCalls)
    }

    @Test
    fun linkedEmptyStateReloadsOnceAndShowsEmptyMessage() {
        var reloadCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                AgentConnectionsRoute(
                    uiState = AgentConnectionsUiState(
                        isLinked = true,
                        isLoading = false,
                        instructions = "",
                        errorMessage = "",
                        revokingConnectionId = null,
                        connections = emptyList()
                    ),
                    onReload = {
                        reloadCalls += 1
                    },
                    onRevokeConnection = {},
                    onBack = {}
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            reloadCalls == 1
        }
        composeRule.onNodeWithText(
            "No long-lived bot connections were created for this account."
        ).assertIsDisplayed()
        assertEquals(1, reloadCalls)
    }

    @Test
    fun revokeButtonCallsCallbackForActiveConnection() {
        var revokedConnectionId: String? = null

        composeRule.setContent {
            FlashcardsTheme {
                AgentConnectionsRoute(
                    uiState = AgentConnectionsUiState(
                        isLinked = true,
                        isLoading = false,
                        instructions = "",
                        errorMessage = "",
                        revokingConnectionId = null,
                        connections = listOf(
                            AgentConnectionItemUiState(
                                connectionId = "conn-1",
                                label = "Primary bot",
                                createdAtLabel = "2026-04-01",
                                lastUsedAtLabel = "2026-04-08",
                                revokedAtLabel = "Active",
                                isRevoked = false
                            )
                        )
                    ),
                    onReload = {},
                    onRevokeConnection = { connectionId ->
                        revokedConnectionId = connectionId
                    },
                    onBack = {}
                )
            }
        }

        composeRule.onNodeWithText("Primary bot").assertIsDisplayed()
        composeRule.onAllNodesWithText("Revoke")[0].performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            revokedConnectionId == "conn-1"
        }
        assertEquals("conn-1", revokedConnectionId)
    }
}
