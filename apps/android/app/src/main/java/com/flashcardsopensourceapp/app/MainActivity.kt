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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val application = application as FlashcardsApplication
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition {
            application.shouldKeepSplashScreenVisible()
        }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (application.isRuntimeSupported) {
            handleIntent(intent = intent, application = application)
        }

        setContent {
            if (application.isRuntimeSupported.not()) {
                FlashcardsUnsupportedRuntimeScreen()
                return@setContent
            }

            // The app graph can be replaced while the activity is stopped, so this state
            // must stay current even outside STARTED to avoid reusing a closed graph.
            val currentAppGraph by application.appGraphState.collectAsState()
            val appNotificationTapRequest by application.appNotificationTapState.collectAsState()
            val appGraph = currentAppGraph
            if (appGraph == null) {
                FlashcardsAppLoadingScreen()
            } else {
                DisposableEffect(appGraph) {
                    val lifecycle = this@MainActivity.lifecycle
                    val observer = LifecycleEventObserver { _, event ->
                        when (event) {
                            Lifecycle.Event.ON_RESUME -> {
                                appGraph.storeReviewActivityProvider.updateActivity(activity = this@MainActivity)
                            }

                            Lifecycle.Event.ON_PAUSE,
                            Lifecycle.Event.ON_STOP,
                            Lifecycle.Event.ON_DESTROY -> {
                                appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainActivity)
                            }

                            else -> Unit
                        }
                    }
                    lifecycle.addObserver(observer)
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                        appGraph.storeReviewActivityProvider.updateActivity(activity = this@MainActivity)
                    } else {
                        appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainActivity)
                    }
                    onDispose {
                        lifecycle.removeObserver(observer)
                        appGraph.storeReviewActivityProvider.clearActivity(activity = this@MainActivity)
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val application = application as FlashcardsApplication
        if (application.isRuntimeSupported.not()) {
            return
        }

        handleIntent(intent = intent, application = application)
    }

    private fun handleIntent(intent: Intent?, application: FlashcardsApplication) {
        val request = intent?.let(::consumeAppNotificationTapRequest) ?: return
        application.requestAppNotificationTap(request = request)
    }
}
