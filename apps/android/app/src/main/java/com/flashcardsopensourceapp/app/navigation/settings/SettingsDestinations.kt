package com.flashcardsopensourceapp.app.navigation.settings

internal data object SettingsRootGraph {
    const val route: String = "settings/root"
}

internal data object SettingsAccountAuthGraph {
    const val route: String = "settings/account/auth/graph"
}

internal data object SettingsAccessGraph {
    const val route: String = "settings/access/graph"
}

data object SettingsCurrentWorkspaceDestination {
    const val route: String = "settings/current-workspace"
}

data object SettingsLanguageDestination {
    const val route: String = "settings/language"
}

data object SettingsReviewAnimationsDestination {
    const val route: String = "settings/review-animations"
}

data object SettingsFeedbackDestination {
    const val route: String = "settings/feedback"
}

data object SettingsWorkspaceDecksDestination {
    const val route: String = "settings/decks"
}

data object SettingsWorkspaceAllCardsDeckDetailDestination {
    const val route: String = "settings/decks/all-cards"
}

data object SettingsWorkspaceDeckDetailDestination {
    const val routePrefix: String = "settings/decks/detail"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object SettingsWorkspaceDeckEditorDestination {
    const val routePrefix: String = "settings/decks/editor"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object SettingsWorkspaceTagsDestination {
    const val route: String = "settings/tags"
}

data object SettingsWorkspaceSchedulerDestination {
    const val route: String = "settings/scheduling"
}

data object SettingsWorkspaceNotificationsDestination {
    const val route: String = "settings/review-reminders"
}

data object SettingsWorkspaceExportDestination {
    const val route: String = "settings/export"
}

data object SettingsWorkspaceResetStudyProgressDestination {
    const val route: String = "settings/workspace/reset-study-progress"
}

data object SettingsWorkspaceDeleteCurrentDestination {
    const val route: String = "settings/workspace/delete-current"
}

data object SettingsAccountServerDestination {
    const val route: String = "settings/server"
}

data object SettingsAccountStatusDestination {
    const val route: String = "settings/account-status"
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

data object SettingsAccountLegalDestination {
    const val route: String = "settings/legal"
}

data object SettingsAccountSupportDestination {
    const val route: String = "settings/support"
}

data object SettingsAccountOpenSourceDestination {
    const val route: String = "settings/open-source"
}

data object SettingsAccountAgentConnectionsDestination {
    const val route: String = "settings/agent-connections"
}

data object SettingsAccountDangerZoneDestination {
    const val route: String = "settings/delete-account"
}

data object SettingsDeviceDestination {
    const val route: String = "settings/device"
}

data object SettingsAccessDestination {
    const val route: String = "settings/access"
}

data object SettingsTestDestination {
    const val route: String = "settings/test"
}

data object SettingsTestAnimationsDestination {
    const val route: String = "settings/test/animations"
}

data object SettingsAccessDetailDestination {
    const val routePrefix: String = "settings/access/detail"
    const val routeArgument: String = "capability"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(capability: String): String {
        return "$routePrefix/$capability"
    }
}
