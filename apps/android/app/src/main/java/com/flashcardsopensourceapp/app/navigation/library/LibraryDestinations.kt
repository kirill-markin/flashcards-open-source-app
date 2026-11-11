package com.flashcardsopensourceapp.app.navigation.library

import com.flashcardsopensourceapp.app.navigation.encodeRouteText

internal data object LibraryRootGraph {
    const val route: String = "library/root"
}

data object LibraryCardsDestination {
    const val route: String = "library/cards"
}

data object LibraryDecksDestination {
    const val route: String = "library/decks"
}

data object LibraryAllCardsDeckDetailDestination {
    const val route: String = "library/decks/all-cards"
}

data object LibraryDeckDetailDestination {
    const val routePrefix: String = "library/decks/detail"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object LibraryDeckEditorDestination {
    const val routePrefix: String = "library/decks/editor"
    const val routeArgument: String = "deckId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(deckId: String): String {
        return "$routePrefix/$deckId"
    }
}

data object LibraryTagsDestination {
    const val route: String = "library/tags"
}

data object LibraryTagDetailDestination {
    private const val routePrefix = "library/tags/detail"
    const val workspaceArgument = "workspaceId"
    const val tagArgument = "tag"
    const val routePattern = "$routePrefix/{$workspaceArgument}/{$tagArgument}"

    fun createRoute(workspaceId: String, tag: String): String {
        return "$routePrefix/$workspaceId/${encodeRouteText(value = tag)}"
    }
}

data object LibraryDeckCatalogDestination {
    const val route: String = "library/catalog"
}

data object LibraryCatalogDeckDestination {
    const val routePrefix: String = "library/catalog/deck"
    const val routeArgument: String = "packageId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(packageId: String): String {
        return "$routePrefix/$packageId"
    }
}

data object LibraryImportDestination {
    const val route: String = "library/import"
}

data object LibraryExportDestination {
    const val route: String = "library/export"
}
