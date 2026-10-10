package com.flashcardsopensourceapp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.flashcardsopensourceapp.app.notifications.consumeAppNotificationTapRequest
import com.flashcardsopensourceapp.core.ui.markHostActivityStarted
import com.flashcardsopensourceapp.core.ui.markHostActivityStopped

class MainHostActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val application = application as FlashcardsApplication
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition {
            application.shouldKeepSplashScreenVisible()
        }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        handleIntent(intent = intent, application = application)

        setContent {
            // The app graph can be replaced while the activity is stopped, so this state
            // must stay current even outside STARTED to avoid reusing a closed graph.
            val currentAppGraph by application.appGraphState.collectAsState()
            val appNotificationTapRequest by application.appNotificationTapState.collectAsState()
            val appGraph = currentAppGraph
            if (appGraph == null) {
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
                    consumeAppNotificationTap = application::consumeAppNotificationTap
                )
            }
        }
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
        val request = intent?.let(::consumeAppNotificationTapRequest) ?: return
        application.requestAppNotificationTap(request = request)
    }
}
