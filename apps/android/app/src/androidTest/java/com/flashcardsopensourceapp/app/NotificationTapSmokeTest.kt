package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestName
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationTapSmokeTest {
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
    fun reviewReminderNotificationTapOpensReviewFromSystemShade() {
        val appContext = ApplicationProvider.getApplicationContext<Context>()
        val markerSuffix = System.currentTimeMillis().toString()
        val requestId = "android-notification-smoke-$markerSuffix"
        val markerText = "Android notif $markerSuffix"

        try {
            liveSmokeContext.step("prepare cards as the current visible screen") {
                liveSmokeContext.openCardsTab()
                liveSmokeContext.waitUntilAtLeastOneExistsOrFail(
                    matcher = hasText("Search cards"),
                    timeoutMillis = internalUiTimeoutMillis
                )
                liveSmokeContext.waitForFlowValue(
                    timeoutMillis = internalUiTimeoutMillis,
                    context = "while confirming cards is the current visible screen",
                    flow = liveSmokeContext.appGraph().visibleAppScreenController.observeVisibleAppScreen()
                ) { screen ->
                    screen == VisibleAppScreen.CARDS
                }
            }

            liveSmokeContext.step("grant notification permission and clear old notifications") {
                liveSmokeContext.grantNotificationPermissionOrThrow(context = appContext)
                liveSmokeContext.clearAppNotifications(context = appContext)
            }

            liveSmokeContext.step("background app and post a real review reminder notification") {
                liveSmokeContext.pressHomeAndWaitForLauncher()
                liveSmokeContext.postReviewReminderNotification(
                    context = appContext,
                    frontText = markerText,
                    requestId = requestId
                )
            }

            liveSmokeContext.step("tap the posted notification from the system shade") {
                liveSmokeContext.openNotificationShadeAndTap(frontText = markerText)
            }

            liveSmokeContext.step("verify the app returns to review without unexpected navigation") {
                liveSmokeContext.waitForAppToReachForeground(packageName = appContext.packageName)
                liveSmokeContext.waitForReviewScreenAfterNotificationTap()
            }
        } finally {
            liveSmokeContext.clearAppNotifications(context = appContext)
        }
    }
}
