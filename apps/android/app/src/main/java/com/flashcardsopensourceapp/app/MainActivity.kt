package com.flashcardsopensourceapp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.flashcardsopensourceapp.app.di.AppStartupState
import com.flashcardsopensourceapp.app.notifications.consumeAppNotificationTapRequest

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val application = application as FlashcardsApplication
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition {
            application.appGraph.startupState.value is AppStartupState.Loading
        }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        handleIntent(intent = intent, application = application)

        setContent {
            FlashcardsApp(appGraph = application.appGraph)
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
        application.appGraph.appHandoffCoordinator.requestAppNotificationTap(request = request)
    }
}
