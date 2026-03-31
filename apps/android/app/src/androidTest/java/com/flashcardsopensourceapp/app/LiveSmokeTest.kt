package com.flashcardsopensourceapp.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestName
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LiveSmokeTest {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()
    private val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(composeRule)

    @get:Rule
    val testNameRule: TestName = TestName()

    private val liveSmokeContext = LiveSmokeContext(
        composeRule = composeRule,
        device = device,
        testNameRule = testNameRule,
        currentStepLabel = "test bootstrap",
        hasPrintedInlineRawScreenStateForCurrentFailure = false
    )

    @Test
    fun linkedWorkspaceSessionSurvivesActivityRelaunch() {
        val runId: String = System.currentTimeMillis().toString()
        val reviewEmail: String = configuredReviewEmail()
        val workspaceName: String = "E2E android session $runId"

        liveSmokeContext.withLinkedWorkspaceSession(
            reviewEmail = reviewEmail,
            workspaceName = workspaceName
        ) {
            liveSmokeContext.step("restart the activity and keep the linked session") {
                liveSmokeContext.relaunchAndAssertAccountStatus(reviewEmail = reviewEmail)
            }
            liveSmokeContext.step("verify linked account status and workspace state") {
                liveSmokeContext.assertLinkedAccountStatus(
                    reviewEmail = reviewEmail,
                    workspaceName = workspaceName
                )
            }
        }
    }

    @Test
    fun manualCardCanBeCreatedInDefaultWorkspace() {
        val runId: String = System.currentTimeMillis().toString()
        val manualFrontText: String = "Manual e2e android $runId"
        val manualBackText: String = "Manual answer e2e android $runId"

        liveSmokeContext.step("create one manual card in the default local workspace") {
            liveSmokeContext.createManualCard(
                frontText = manualFrontText,
                backText = manualBackText,
                markerTag = "manual-$runId"
            )
        }
        liveSmokeContext.step("verify the manual card in cards") {
            liveSmokeContext.assertCardVisibleInCards(
                searchText = manualFrontText,
                timeoutMillis = internalUiTimeoutMillis
            )
        }
    }

    @Test
    fun manualCardCanBeReviewedInDefaultWorkspace() {
        val runId: String = System.currentTimeMillis().toString()
        val manualFrontText: String = "Manual review e2e android $runId"
        val manualBackText: String = "Manual review answer e2e android $runId"

        liveSmokeContext.step("seed one manual card directly in the default local workspace") {
            liveSmokeContext.seedLocalCard(
                frontText = manualFrontText,
                backText = manualBackText,
                markerTag = "manual-review-$runId"
            )
        }
        liveSmokeContext.step("verify the seeded manual card in review") {
            liveSmokeContext.assertCardReachableInReview(
                expectedFrontText = manualFrontText,
                timeoutMillis = internalUiTimeoutMillis
            )
            liveSmokeContext.rateVisibleReviewCardGood()
        }
    }

    @Test
    fun guestAiCardCanBeCreatedWithExplicitConfirmation() {
        liveSmokeContext.step("create one AI card as guest and confirm the insert completed") {
            liveSmokeContext.createAiCardWithConfirmation()
        }
    }

    @Test
    fun guestAiNewChatResetsConversationCleanly() {
        val runId: String = System.currentTimeMillis().toString()
        val guestPrompt: String = "Reply with exactly ANDROID_SMOKE_RESET_$runId"

        liveSmokeContext.step("start a minimal guest AI conversation") {
            liveSmokeContext.createGuestAiConversation(
                promptText = guestPrompt,
                expectedAssistantText = "ANDROID_SMOKE_RESET_$runId"
            )
        }
        liveSmokeContext.step("start a new chat and confirm the conversation resets cleanly") {
            liveSmokeContext.startNewChatAndAssertConversationReset()
        }
    }

    @Test
    fun guestAiCardSurvivesActivityRelaunchAndIsReviewable() {
        val runId: String = System.currentTimeMillis().toString()
        val aiFrontText: String = "AI review e2e android $runId"
        val aiBackText: String = "AI review answer e2e android $runId"

        liveSmokeContext.step("create one AI card with explicit confirmation as guest in the default workspace") {
            liveSmokeContext.createTaggedAiCardWithConfirmation(
                aiFrontText = aiFrontText,
                aiBackText = aiBackText,
                markerTag = "ai-review-$runId"
            )
        }
        liveSmokeContext.step("force a sync in the current guest workspace and wait for the AI card locally") {
            liveSmokeContext.forceSyncAndWaitForLocalCard(
                expectedFrontText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
        }
        liveSmokeContext.step("restart the activity after AI card creation and keep the guest session") {
            liveSmokeContext.relaunchAndAssertGuestAccountStatus()
        }
        liveSmokeContext.step("verify the AI-created card in cards and review") {
            liveSmokeContext.assertCardVisibleInCards(
                searchText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
            liveSmokeContext.assertCardReachableInReview(
                expectedFrontText = aiFrontText,
                timeoutMillis = externalUiTimeoutMillis
            )
            liveSmokeContext.rateVisibleReviewCardGood()
        }
    }

    private fun configuredReviewEmail(): String {
        return InstrumentationRegistry.getArguments()
            .getString(reviewEmailArgumentKey, "google-review@example.com")
    }
}
