package com.flashcardsopensourceapp.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val application = application as FlashcardsApplication

        lifecycleScope.launch {
            application.appGraph.ensureLocalWorkspaceShell(
                currentTimeMillis = System.currentTimeMillis()
            )
        }

        setContent {
            FlashcardsApp(appGraph = application.appGraph)
        }
    }
}
