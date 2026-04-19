package com.flashcardsopensourceapp.app.livesmoke

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.AppStateResetRule
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestName
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LiveSmokeTest : FirebaseAppInstrumentationTimeoutTest() {
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
    fun linkedWorkspaceAccountStatusAndWorkspaceStateAreVisible() {
        val runId: String = System.currentTimeMillis().toString()
        val reviewEmail: String = configuredReviewEmail()
        val workspaceName: String = "E2E android session $runId"

        liveSmokeContext.withLinkedWorkspaceSession(
            reviewEmail = reviewEmail,
            workspaceName = workspaceName
        ) {
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
    fun resetWorkspaceProgressRestoresAReviewedCardToReview() {
        val runId: String = System.currentTimeMillis().toString()
        val workspaceName: String = "E2E android reset $runId"
        val manualFrontText: String = "Manual reset e2e android $runId"
        val manualBackText: String = "Manual answer reset e2e android $runId"
        val reviewEmail: String = configuredReviewEmail()

        liveSmokeContext.withLinkedWorkspaceSession(
            reviewEmail = reviewEmail,
            workspaceName = workspaceName
        ) {
            liveSmokeContext.step("create one manual card in the linked workspace") {
                liveSmokeContext.createManualCard(
                    frontText = manualFrontText,
                    backText = manualBackText,
                    markerTag = "reset-progress-$runId"
                )
            }

            liveSmokeContext.step("review the card once") {
                liveSmokeContext.assertCardReachableInReview(
                    expectedFrontText = manualFrontText,
                    timeoutMillis = externalUiTimeoutMillis
                )
                liveSmokeContext.rateVisibleReviewCardGood()
            }

            liveSmokeContext.step("open reset all progress flow and confirm the preview count is one") {
                liveSmokeContext.resetWorkspaceProgressFromSettings(expectedCardsToResetCount = 1)
            }

            liveSmokeContext.step("verify the workspace summary reflects the reset card state") {
                liveSmokeContext.assertWorkspaceTodayCounts(
                    expectedDueCount = 1,
                    expectedNewCount = 1,
                    expectedReviewedCount = 0
                )
            }

            liveSmokeContext.step("verify the same card reappears in review") {
                liveSmokeContext.openReviewTab()
                liveSmokeContext.assertCardReachableInReview(
                    expectedFrontText = manualFrontText,
                    timeoutMillis = externalUiTimeoutMillis
                )
            }
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
        liveSmokeContext.step("create one guest AI conversation before reset") {
            liveSmokeContext.createGuestAiConversationForReset()
        }
        liveSmokeContext.step("start a new chat and confirm the conversation resets cleanly") {
            liveSmokeContext.startNewChatAndAssertConversationReset()
        }
    }

    private fun configuredReviewEmail(): String {
        return InstrumentationRegistry.getArguments()
            .getString(reviewEmailArgumentKey, "google-review@example.com")
    }
}
