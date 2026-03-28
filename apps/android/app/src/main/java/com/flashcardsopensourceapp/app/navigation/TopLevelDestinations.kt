package com.flashcardsopensourceapp.app.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.FlipToFront
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

/*
 Keep Android navigation destinations aligned with:
 - apps/web/src/routes.ts
 - apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift
 */

sealed interface TopLevelDestination {
    val route: String
    val label: String
    val icon: ImageVector
}

data object ReviewDestination : TopLevelDestination {
    override val route: String = "review"
    override val label: String = "Review"
    override val icon: ImageVector = Icons.Outlined.FlipToFront
}

data object CardsDestination : TopLevelDestination {
    override val route: String = "cards"
    override val label: String = "Cards"
    override val icon: ImageVector = Icons.Outlined.CollectionsBookmark
}

data object AiDestination : TopLevelDestination {
    override val route: String = "ai"
    override val label: String = "AI"
    override val icon: ImageVector = Icons.Outlined.AutoAwesome
}

data object SettingsDestination : TopLevelDestination {
    override val route: String = "settings"
    override val label: String = "Settings"
    override val icon: ImageVector = Icons.Outlined.Settings
}

val topLevelDestinations: List<TopLevelDestination> = listOf(
    ReviewDestination,
    CardsDestination,
    AiDestination,
    SettingsDestination
)
