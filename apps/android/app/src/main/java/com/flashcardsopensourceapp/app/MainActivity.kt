package com.flashcardsopensourceapp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.flashcardsopensourceapp.app.notifications.consumeReviewNotificationTapPayload
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val application = application as FlashcardsApplication
        handleIntent(intent = intent, application = application)

        lifecycleScope.launch {
            application.appGraph.ensureLocalWorkspaceShell(
                currentTimeMillis = System.currentTimeMillis()
            )
        }

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
        val payload = intent?.let(::consumeReviewNotificationTapPayload) ?: return
        application.appGraph.appHandoffCoordinator.requestReviewNotification(payload = payload)
    }
}
