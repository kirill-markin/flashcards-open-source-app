package com.flashcardsopensourceapp.app.livesmoke

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.MainHostActivity
import com.flashcardsopensourceapp.app.automation.resolveAutomationEnvironment
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.clickTag
import com.flashcardsopensourceapp.app.livesmoke.diagnostics.waitForTagToExist
import com.flashcardsopensourceapp.app.livesmoke.flows.openReviewTab
import com.flashcardsopensourceapp.app.livesmoke.support.LiveSmokeContext
import com.flashcardsopensourceapp.app.livesmoke.support.appGraph
import com.flashcardsopensourceapp.app.livesmoke.support.internalUiTimeoutMillis
import com.flashcardsopensourceapp.app.livesmoke.support.step
import com.flashcardsopensourceapp.app.support.AppStateResetRule
import com.flashcardsopensourceapp.app.support.RepositorySeedCard
import com.flashcardsopensourceapp.app.support.RepositorySeedResult
import com.flashcardsopensourceapp.app.support.RepositorySeedScenario
import com.flashcardsopensourceapp.app.support.createRepositorySeedExecutor
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.feature.review.reviewCopyBackTextButtonTag
import com.flashcardsopensourceapp.feature.review.reviewCopyFrontTextButtonTag
import com.flashcardsopensourceapp.feature.review.reviewShowAnswerButtonTag
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestName
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReviewClipboardSmokeTest : FirebaseAppInstrumentationTimeoutTest() {
    private val composeRule = createAndroidComposeRule<MainHostActivity>()

    @get:Rule
    val ruleChain: TestRule = RuleChain.outerRule(AppStateResetRule()).around(composeRule)

    @get:Rule
    val testNameRule: TestName = TestName()

    private val liveSmokeContext = LiveSmokeContext(
        composeRule = composeRule,
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()),
        testNameRule = testNameRule,
        currentStepLabel = "test bootstrap",
        hasPrintedInlineRawScreenStateForCurrentFailure = false
    )

    @Test
    fun frontAndBackCopyPreserveMarkdownAndStoredCard() {
        val frontText: String = """
            # Which formula does this diagram illustrate?

            Keep **Markdown** and ${'$'}\alpha + \beta${'$'} verbatim.
            ![Public diagram](https://example.com/public-diagram.png)
            ![Private diagram](fcasset:clipboard-front?state=pending)

            ```markdown
            ![Literal fenced image](fcasset:literal-front?state=pending)
            ```
            Inline example: `![Literal inline image](fcasset:inline-front)`
        """.trimIndent()
        val expectedFront: String = """
            # Which formula does this diagram illustrate?

            Keep **Markdown** and ${'$'}\alpha + \beta${'$'} verbatim.
            ![Public diagram](https://example.com/public-diagram.png)
            [Private media: Private diagram]

            ```markdown
            ![Literal fenced image](fcasset:literal-front?state=pending)
            ```
            Inline example: `![Literal inline image](fcasset:inline-front)`
        """.trimIndent()
        val backText: String = """
            The **answer** is:

            ${'$'}${'$'}
            \frac{a}{b} = c
            ${'$'}${'$'}

            - Keep [the public link](https://example.com/reference).
            ![Public answer](https://example.com/public-answer.png)
            ![Private answer](fcasset:clipboard-back?state=pending)
            `![Inline answer example](fcasset:inline-back?state=pending)`
            ```markdown
            ![Fenced answer example](fcasset:fenced-back)
            ```
        """.trimIndent()
        val expectedBack: String = """
            The **answer** is:

            ${'$'}${'$'}
            \frac{a}{b} = c
            ${'$'}${'$'}

            - Keep [the public link](https://example.com/reference).
            ![Public answer](https://example.com/public-answer.png)
            [Private media: Private answer]
            `![Inline answer example](fcasset:inline-back?state=pending)`
            ```markdown
            ![Fenced answer example](fcasset:fenced-back)
            ```
        """.trimIndent()
        val appGraph: AppGraph = liveSmokeContext.appGraph()
        assertTrue(resolveAutomationEnvironment(composeRule.activity.contentResolver).isAutomation)
        assertNotEquals(
            CloudAccountState.LINKED,
            runBlocking { appGraph.cloudAccountRepository.observeCloudSettings().first().cloudState }
        )
        val seededCard: CardEntity = runBlocking {
            val result: RepositorySeedResult = createRepositorySeedExecutor().seedCardsAndReviewsInCurrentWorkspace(
                seedScenario = RepositorySeedScenario(
                    cards = listOf(
                        RepositorySeedCard(
                            frontText = frontText,
                            backText = backText,
                            tags = listOf("clipboard-smoke"),
                            reviews = emptyList()
                        )
                    )
                )
            )
            requireNotNull(appGraph.database.cardDao().loadCard(cardId = result.cards.single().cardId))
        }
        assertEquals(frontText, seededCard.frontText)
        assertEquals(backText, seededCard.backText)
        composeRule.waitForIdle()

        liveSmokeContext.step("copy the front source from the real review card") {
            liveSmokeContext.openReviewTab()
            copySideAndAssertClipboard(tag = reviewCopyFrontTextButtonTag, expectedText = expectedFront)
            assertEquals(seededCard, runBlocking { appGraph.database.cardDao().loadCard(seededCard.cardId) })
        }
        liveSmokeContext.step("reveal and copy the back source without changing the card") {
            liveSmokeContext.clickTag(tag = reviewShowAnswerButtonTag, label = "Show answer")
            copySideAndAssertClipboard(tag = reviewCopyBackTextButtonTag, expectedText = expectedBack)
            assertEquals(seededCard, runBlocking { appGraph.database.cardDao().loadCard(seededCard.cardId) })
        }
    }

    private fun copySideAndAssertClipboard(tag: String, expectedText: String) {
        liveSmokeContext.waitForTagToExist(
            tag = tag,
            timeoutMillis = internalUiTimeoutMillis,
            context = "before copying review source"
        )
        composeRule.onNodeWithTag(tag).performScrollTo()
        liveSmokeContext.clickTag(tag = tag, label = "Copy review side as Markdown")
        composeRule.runOnIdle {
            assertTrue("The target app must have focus to read its clipboard", composeRule.activity.hasWindowFocus())
            val clipboard: ClipboardManager = requireNotNull(
                composeRule.activity.getSystemService(ClipboardManager::class.java)
            )
            val clip: ClipData = requireNotNull(clipboard.primaryClip) { "Copy did not set the Android clipboard" }
            assertEquals(1, clip.itemCount)
            assertEquals(expectedText, clip.getItemAt(0).text?.toString())
        }
    }
}
