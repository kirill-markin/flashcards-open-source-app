package com.flashcardsopensourceapp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
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
        handleIntent(intent = intent, application = application)
    }

    private fun handleIntent(intent: Intent?, application: FlashcardsApplication) {
        val request = intent?.let(::consumeAppNotificationTapRequest) ?: return
        application.requestAppNotificationTap(request = request)
    }
}
