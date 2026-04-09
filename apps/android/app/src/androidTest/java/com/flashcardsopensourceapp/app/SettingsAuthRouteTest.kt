package com.flashcardsopensourceapp.app

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.feature.settings.CloudSignInCodeRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInEmailRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsAuthRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun verifyCodeBackReturnsToSignInScreen() {
        var route by mutableStateOf(value = "email")
        var email by mutableStateOf(value = "user@example.com")
        var code by mutableStateOf(value = "")

        composeRule.setContent {
            FlashcardsTheme {
                when (route) {
                    "email" -> {
                        CloudSignInEmailRoute(
                            uiState = CloudSignInUiState(
                                email = email,
                                code = "",
                                isGuestUpgrade = false,
                                isSendingCode = false,
                                isVerifyingCode = false,
                                errorMessage = "",
                                errorTechnicalDetails = null,
                                challengeEmail = null
                            ),
                            onEmailChange = { email = it },
                            onSendCode = { route = "code" },
                            onBack = {}
                        )
                    }

                    "code" -> {
                        CloudSignInCodeRoute(
                            uiState = CloudSignInUiState(
                                email = email,
                                code = code,
                                isGuestUpgrade = false,
                                isSendingCode = false,
                                isVerifyingCode = false,
                                errorMessage = "",
                                errorTechnicalDetails = null,
                                challengeEmail = email
                            ),
                            onCodeChange = { code = it },
                            onVerifyCode = {},
                            onBack = { route = "email" }
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithText("Sign in").assertIsDisplayed()
        composeRule.onNodeWithText("Send one-time code").performClick()
        composeRule.onNodeWithText("One-time code").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Back").performClick()
        composeRule.onNodeWithText("Sign in").assertIsDisplayed()
    }
}
