package com.flashcardsopensourceapp.app.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CollectionsBookmark
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

sealed interface TopLevelDestination {
    val route: String
    val label: String
    val icon: ImageVector
}

data object ReviewDestination : TopLevelDestination {
    override val route: String = "review"
    override val label: String = "Review"
    override val icon: ImageVector = Icons.Outlined.PlayCircle
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

data object CardEditorDestination {
    const val routePrefix: String = "cards/editor"
    const val routeArgument: String = "cardId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(cardId: String): String {
        return "$routePrefix/$cardId"
    }
}

data object SettingsWorkspaceDestination {
    const val route: String = "settings/workspace"
}

data object SettingsAccountDestination {
    const val route: String = "settings/account"
}

data object SettingsDeviceDestination {
    const val route: String = "settings/device"
}

data object SettingsAccessDestination {
    const val route: String = "settings/access"
}

val topLevelDestinations: List<TopLevelDestination> = listOf(
    ReviewDestination,
    CardsDestination,
    AiDestination,
    SettingsDestination
)
