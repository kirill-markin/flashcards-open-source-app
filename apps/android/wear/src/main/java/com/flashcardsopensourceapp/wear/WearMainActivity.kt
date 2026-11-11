package com.flashcardsopensourceapp.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import com.flashcardsopensourceapp.wear.handoff.WearHandoffClient
import com.flashcardsopensourceapp.wear.review.WearReviewViewModel
import com.flashcardsopensourceapp.wear.session.WearSessionViewModel
import com.flashcardsopensourceapp.wear.ui.WearRootScreen

// The control color the phone and iPhone apps use.
private val wearColorScheme: ColorScheme = ColorScheme(
    primary = Color(0xFFFF6719),
    onPrimary = Color(0xFF101417)
)

class WearMainActivity : ComponentActivity() {
    private val sessionViewModel: WearSessionViewModel by viewModels {
        WearSessionViewModel.factory(
            appGraph = (application as WearApplication).appGraph,
            handoffClient = WearHandoffClient(context = applicationContext)
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // Asks the phone on launch and on every return to the foreground.
            LifecycleResumeEffect(sessionViewModel) {
                sessionViewModel.refreshFromPhone()
                onPauseOrDispose {}
            }
            MaterialTheme(colorScheme = wearColorScheme) {
                AppScaffold {
                    WearRootScreen(
                        viewModel = sessionViewModel,
                        reviewViewModelFactory = WearReviewViewModel.factory(
                            appGraph = (application as WearApplication).appGraph,
                            sessionViewModel = sessionViewModel
                        )
                    )
                }
            }
        }
    }
}
