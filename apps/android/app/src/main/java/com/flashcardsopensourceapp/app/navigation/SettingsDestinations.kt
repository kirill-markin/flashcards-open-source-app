package com.flashcardsopensourceapp.app.navigation

internal data object SettingsRootGraph {
    const val route: String = "settings/root"
}

internal data object SettingsWorkspaceGraph {
    const val route: String = "settings/workspace/graph"
}

internal data object SettingsAccountGraph {
    const val route: String = "settings/account/graph"
}

internal data object SettingsAccountAuthGraph {
    const val route: String = "settings/account/auth/graph"
}

internal data object SettingsAccessGraph {
    const val route: String = "settings/access/graph"
}

data object SettingsWorkspaceDestination {
    const val route: String = "settings/workspace"
}

data object SettingsCurrentWorkspaceDestination {
    const val route: String = "settings/current-workspace"
}

data object SettingsWorkspaceOverviewDestination {
    const val route: String = "settings/workspace/overview"
}

data object SettingsWorkspaceDecksDestination {
    const val route: String = "settings/workspace/decks"
}

data object SettingsWorkspaceAllCardsDeckDetailDestination {
    const val route: String = "settings/workspace/decks/all-cards"
}

data object SettingsWorkspaceDeckDetailDestination {
    const val routePrefix: String = "settings/workspace/decks/detail"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object SettingsWorkspaceDeckEditorDestination {
    const val routePrefix: String = "settings/workspace/decks/editor"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object SettingsWorkspaceTagsDestination {
    const val route: String = "settings/workspace/tags"
}

data object SettingsWorkspaceSchedulerDestination {
    const val route: String = "settings/workspace/scheduler"
}

data object SettingsWorkspaceNotificationsDestination {
    const val route: String = "settings/workspace/notifications"
}

data object SettingsWorkspaceExportDestination {
    const val route: String = "settings/workspace/export"
}

data object SettingsAccountDestination {
    const val route: String = "settings/account"
}

data object SettingsAccountAdvancedDestination {
    const val route: String = "settings/account/advanced"
}

data object SettingsAccountServerDestination {
    const val route: String = "settings/account/advanced/server"
}

data object SettingsAccountStatusDestination {
    const val route: String = "settings/account/status"
}

data object SettingsAccountSignInEmailDestination {
    const val route: String = "settings/account/sign-in"
}

data object SettingsAccountSignInCodeDestination {
    const val route: String = "settings/account/sign-in/code"
}

data object SettingsAccountPostAuthDestination {
    const val route: String = "settings/account/sign-in/post-auth"
}

data object SettingsAccountLegalSupportDestination {
    const val route: String = "settings/account/legal-support"
}

data object SettingsAccountOpenSourceDestination {
    const val route: String = "settings/account/open-source"
}

data object SettingsAccountAgentConnectionsDestination {
    const val route: String = "settings/account/agent-connections"
}

data object SettingsAccountDangerZoneDestination {
    const val route: String = "settings/account/danger-zone"
}

data object SettingsDeviceDestination {
    const val route: String = "settings/device"
}

data object SettingsAccessDestination {
    const val route: String = "settings/access"
}

data object SettingsAccessDetailDestination {
    const val routePrefix: String = "settings/access/detail"
    const val routeArgument: String = "capability"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(capability: String): String {
        return "$routePrefix/$capability"
    }
}
