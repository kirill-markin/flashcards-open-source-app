package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.MainActivity
import com.flashcardsopensourceapp.app.navigation.SettingsDestination
import com.flashcardsopensourceapp.app.support.AppStateResetRule
import com.flashcardsopensourceapp.data.local.ai.store.OwnOpenAiKeyStore
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyFieldTag
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyRowTag
import com.flashcardsopensourceapp.feature.settings.settingsOwnOpenAiKeyToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsRootScreenTag
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OwnOpenAiKeySmokeTest {
    private val composeRule = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain.outerRule(AppStateResetRule()).around(composeRule)

    @Test
    fun ownKeyIsStoredEncryptedAndClearedOnLogout() {
        val testKey = "sk-preflight-invalid"
        val application = ApplicationProvider.getApplicationContext<FlashcardsApplication>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            composeRule.onNodeWithTag(SettingsDestination.testTag).performClick()
            composeRule.onNodeWithTag(settingsRootScreenTag)
                .performScrollToNode(hasTestTag(settingsOwnOpenAiKeyRowTag))
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyRowTag).performClick()
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyToggleTag).assertIsOff().performClick()
            composeRule.waitUntil(timeoutMillis = 10_000L) {
                composeRule.onAllNodes(hasTestTag(settingsOwnOpenAiKeyFieldTag).and(isEnabled()))
                    .fetchSemanticsNodes().isNotEmpty()
            }
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyFieldTag).performTextReplacement(testKey)
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyToggleTag).assertIsOn().performClick()
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyFieldTag).assertDoesNotExist()
            composeRule.onNodeWithTag(settingsOwnOpenAiKeyToggleTag).performClick()
            composeRule.waitUntil(timeoutMillis = 10_000L) {
                runBlocking {
                    OwnOpenAiKeyStore(context = application, scope = scope).activeApiKeyOrNull() == testKey
                }
            }
            runBlocking { application.appGraph.cloudAccountRepository.logout() }
            val clearedStore = OwnOpenAiKeyStore(context = application, scope = scope)
            assertFalse(clearedStore.observeSettings().value.isEnabled)
            assertNull(runBlocking { clearedStore.activeApiKeyOrNull() })
            clearedStore.updateEnabled(isEnabled = true)
            assertNull(runBlocking { clearedStore.activeApiKeyOrNull() })
            assertEquals("", clearedStore.observeSettings().value.apiKey)
            runBlocking { clearedStore.clear() }
        } finally {
            scope.cancel()
        }
    }
}
