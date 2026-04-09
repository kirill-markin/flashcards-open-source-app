package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestName
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.junit.runner.Description
import org.junit.runners.model.Statement

@RunWith(AndroidJUnit4::class)
class NotificationTapSmokeTest : FirebaseAppInstrumentationTimeoutTest() {
    private val appStateResetRule = AppStateResetRule()
    private val composeRule = createAndroidComposeRule<MainActivity>()
    private val device: UiDevice = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @get:Rule
    val ruleChain: TestRule = RuleChain
        .outerRule(appStateResetRule)
        .around(NotificationTapComposeRule(delegate = composeRule))

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
        val secondaryRequestId = "android-notification-smoke-secondary-$markerSuffix"
        val tertiaryRequestId = "android-notification-smoke-tertiary-$markerSuffix"
        val markerText = "Android notif primary $markerSuffix"
        val secondaryMarkerText = "Android notif secondary $markerSuffix"
        val tertiaryMarkerText = "Android notif tertiary $markerSuffix"

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

            liveSmokeContext.step("background app and post three real review reminder notifications") {
                liveSmokeContext.pressHomeAndWaitForLauncher()
                liveSmokeContext.postReviewReminderNotification(
                    context = appContext,
                    frontText = markerText,
                    requestId = requestId
                )
                liveSmokeContext.postReviewReminderNotification(
                    context = appContext,
                    frontText = secondaryMarkerText,
                    requestId = secondaryRequestId
                )
                liveSmokeContext.postReviewReminderNotification(
                    context = appContext,
                    frontText = tertiaryMarkerText,
                    requestId = tertiaryRequestId
                )
            }

            liveSmokeContext.step("tap the posted notification from the system shade") {
                liveSmokeContext.openNotificationShadeAndTap(frontText = markerText)
            }

            liveSmokeContext.step("verify the app returns to review without unexpected navigation") {
                liveSmokeContext.waitForReviewScreenAfterNotificationTap()
            }

            liveSmokeContext.step("verify the remaining review reminders are removed after the app becomes active") {
                liveSmokeContext.waitUntilWithMitigation(
                    timeoutMillis = externalUiTimeoutMillis,
                    context = "while waiting for review notifications to clear after foregrounding the app"
                ) {
                    liveSmokeContext.activeAppNotificationIds(context = appContext).isEmpty()
                }
            }
        } finally {
            liveSmokeContext.clearAppNotifications(context = appContext)
        }
    }
}

private class NotificationTapComposeRule(
    private val delegate: AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>
) : TestRule {
    override fun apply(base: Statement, description: Description): Statement {
        val delegateStatement = delegate.apply(base, description)
        return object : Statement() {
            override fun evaluate() {
                try {
                    delegateStatement.evaluate()
                } catch (error: NullPointerException) {
                    if (isIgnorableNotificationTapTeardownFailure(error = error)) {
                        return
                    }
                    throw error
                }
            }
        }
    }
}

private fun isIgnorableNotificationTapTeardownFailure(error: NullPointerException): Boolean {
    val message = error.message.orEmpty()
    if (message.contains("Current state was null unexpectedly").not()) {
        return false
    }

    val stackTraceText = error.stackTraceToString()
    return stackTraceText.contains("androidx.test.core.app.ActivityScenario.close") &&
        stackTraceText.contains("androidx.test.ext.junit.rules.ActivityScenarioRule.after")
}
