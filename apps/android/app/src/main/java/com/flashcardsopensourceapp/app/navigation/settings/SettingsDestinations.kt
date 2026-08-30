package com.flashcardsopensourceapp.app.navigation.settings

import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface

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

data object SettingsAiChatSuggestionsDestination {
    const val route: String = "settings/ai-chat-suggestions"
}

data object SettingsLeaderboardParticipationDestination {
    const val route: String = "settings/leaderboard-participation"
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

data object SettingsNotificationsDestination {
    const val route: String = "settings/review-reminders"
}

data object SettingsWorkspaceExportDestination {
    const val route: String = "settings/export"
}

data object SettingsWorkspaceImportDestination {
    const val route: String = "settings/import"
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

/**
 * Start destination of [SettingsAccountAuthGraph]. It lives under a `settings/` path but is opened
 * from settings, the progress screen, the AI screen and the after-review guest prompt alike, so the
 * surface that owns the tapped control rides along as an optional query argument and ends up on the
 * graph's back stack entry, which is where `signin_failed` reads it from.
 *
 * [routePrefix] is not navigable on its own: navigating it still matches this destination, but the
 * origin stays unset and `signin_failed` then reports no surface. Navigate with [createRoute]; the
 * bare prefix is only for the `isWithinRoutePrefix` checks in `FlashcardsApp` and
 * `analyticsSurfaceForRoute`, which match this destination's own `?` boundary as well as the `/`
 * boundary of the code and post-auth steps nested under this path, so the after-review and feedback
 * prompts stay held back for the whole sign-in flow rather than only its first screen and every
 * step of the flow reports the same surface. A sibling route that merely opened with the same
 * characters would not be matched by them.
 */
data object SettingsAccountSignInEmailDestination {
    const val routePrefix: String = "settings/account/sign-in"
    const val routeArgument: String = "origin"
    const val routePattern: String = "$routePrefix?$routeArgument={$routeArgument}"

    fun createRoute(origin: AnalyticsSurface): String {
        return "$routePrefix?$routeArgument=${origin.wireValue}"
    }
}

data object SettingsAccountSignInCodeDestination {
    const val route: String = "${SettingsAccountSignInEmailDestination.routePrefix}/code"
}

data object SettingsAccountPostAuthDestination {
    const val route: String = "${SettingsAccountSignInEmailDestination.routePrefix}/post-auth"
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

data object SettingsNotificationDiagnosticsDestination {
    const val route: String = "settings/test/notification-diagnostics"
}

data object SettingsLocalSyncDiagnosticsDestination {
    const val route: String = "settings/test/local-sync-diagnostics"
}

data object SettingsAccessDetailDestination {
    const val routePrefix: String = "settings/access/detail"
    const val routeArgument: String = "capability"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(capability: String): String {
        return "$routePrefix/$capability"
    }
}
