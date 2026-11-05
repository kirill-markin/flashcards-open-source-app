package com.flashcardsopensourceapp.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.flashcardsopensourceapp.app.notifications.consumeAppNotificationTapRequest
import com.flashcardsopensourceapp.app.widget.consumeReviewWidgetTapRequest
import com.flashcardsopensourceapp.core.ui.markHostActivityStarted
import com.flashcardsopensourceapp.core.ui.markHostActivityStopped
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsAppearance

// The default `enableEdgeToEdge()` navigation bar scrims, which the library does not expose.
private val lightNavigationBarScrim: Int = Color.argb(0xE6, 0xFF, 0xFF, 0xFF)
private val darkNavigationBarScrim: Int = Color.argb(0x80, 0x1B, 0x1B, 0x1B)

class MainHostActivity : ComponentActivity() {
    // `enableEdgeToEdge` re-runs its first call's setup on configuration changes, so the
    // `detectDarkMode` lambdas must read the current appearance instead of capturing it.
    private var systemBarAppearance: FlashcardsAppearance = FlashcardsAppearance.DARK

    override fun onCreate(savedInstanceState: Bundle?) {
        val application = application as FlashcardsApplication
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition {
            application.shouldKeepSplashScreenVisible()
        }
        super.onCreate(savedInstanceState)
        applySystemBarAppearance(appearance = FlashcardsAppearance.DARK)

        handleIntent(intent = intent, application = application)

        setContent {
            // The app graph can be replaced while the activity is stopped, so this state
            // must stay current even outside STARTED to avoid reusing a closed graph.
            val currentAppGraph by application.appGraphState.collectAsState()
            val appNotificationTapRequest by application.appNotificationTapState.collectAsState()
            val reviewWidgetTapRequest by application.reviewWidgetTapState.collectAsState()
            val appGraph = currentAppGraph
            if (appGraph == null) {
                // The loading screen is always dark, whatever theme the detached app graph showed.
                LaunchedEffect(Unit) {
                    applySystemBarAppearance(appearance = FlashcardsAppearance.DARK)
                }
                FlashcardsAppLoadingScreen()
            } else {
                DisposableEffect(appGraph) {
                    val lifecycle = this@MainHostActivity.lifecycle
                    val observer = LifecycleEventObserver { _, event ->
                        when (event) {
                            Lifecycle.Event.ON_RESUME -> {
                                appGraph.storeReviewActivityProvider.updateActivity(activity = this@MainHostActivity)
                            }

                            Lifecycle.Event.ON_PAUSE,
                            Lifecycle.Event.ON_STOP,
                            Lifecycle.Event.ON_DESTROY -> {
                                appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainHostActivity)
                            }

                            else -> Unit
                        }
                    }
                    lifecycle.addObserver(observer)
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                        appGraph.storeReviewActivityProvider.updateActivity(activity = this@MainHostActivity)
                    } else {
                        appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainHostActivity)
                    }
                    onDispose {
                        lifecycle.removeObserver(observer)
                        appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainHostActivity)
                    }
                }
                FlashcardsApp(
                    appGraph = appGraph,
                    appNotificationTapRequest = appNotificationTapRequest,
                    consumeAppNotificationTap = application::consumeAppNotificationTap,
                    reviewWidgetTapRequest = reviewWidgetTapRequest,
                    consumeReviewWidgetTap = application::consumeReviewWidgetTap,
                    applySystemBarAppearance = { appearance -> applySystemBarAppearance(appearance = appearance) }
                )
            }
        }
    }

    /** System bar icons follow the app theme, never the OS dark mode setting. */
    private fun applySystemBarAppearance(appearance: FlashcardsAppearance) {
        systemBarAppearance = appearance
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(
                lightScrim = Color.TRANSPARENT,
                darkScrim = Color.TRANSPARENT,
                detectDarkMode = { systemBarAppearance == FlashcardsAppearance.DARK }
            ),
            navigationBarStyle = SystemBarStyle.auto(
                lightScrim = lightNavigationBarScrim,
                darkScrim = darkNavigationBarScrim,
                detectDarkMode = { systemBarAppearance == FlashcardsAppearance.DARK }
            )
        )
    }

    // The marks have to be unconditional. `onStop` always precedes a system-initiated `onDestroy`,
    // which makes the flag a usable discriminator for a `ViewModel` being cleared.
    override fun onStart() {
        super.onStart()
        markHostActivityStarted()
    }

    override fun onStop() {
        markHostActivityStopped()
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val application = application as FlashcardsApplication
        handleIntent(intent = intent, application = application)
    }

    private fun handleIntent(intent: Intent?, application: FlashcardsApplication) {
        val uri = intent?.data
        if (intent?.action == Intent.ACTION_VIEW && uri?.scheme == "com.nibomo.app") {
            intent.data = null
            application.acceptAppleSignInReturn(uri.toString())
            return
        }
        if (intent == null) {
            return
        }
        val reviewWidgetTapRequest = consumeReviewWidgetTapRequest(intent = intent)
        if (reviewWidgetTapRequest != null) {
            application.requestReviewWidgetTap(request = reviewWidgetTapRequest)
            return
        }
        val request = consumeAppNotificationTapRequest(intent = intent) ?: return
        application.requestAppNotificationTap(request = request)
    }
}
