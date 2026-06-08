package com.flashcardsopensourceapp.feature.settings

import androidx.compose.material3.Badge
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun SettingsAttentionBadge(count: Int) {
    Badge {
        Text(text = count.toString())
    }
}
