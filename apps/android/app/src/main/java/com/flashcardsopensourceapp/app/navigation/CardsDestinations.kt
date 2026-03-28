package com.flashcardsopensourceapp.app.navigation

data object CardEditorDestination {
    const val routePrefix: String = "cards/editor"
    const val routeArgument: String = "cardId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(cardId: String): String {
        return "$routePrefix/$cardId"
    }
}

data object CardEditorTextDestination {
    const val routePrefix: String = "cards/editor/text"
    const val cardIdArgument: String = "cardId"
    const val fieldArgument: String = "field"
    const val routePattern: String = "$routePrefix/{$cardIdArgument}/{$fieldArgument}"

    fun createRoute(cardId: String, field: String): String {
        return "$routePrefix/$cardId/$field"
    }
}

data object CardEditorTagsDestination {
    const val routePrefix: String = "cards/editor/tags"
    const val routeArgument: String = "cardId"
    const val routePattern: String = "$routePrefix/{$routeArgument}"

    fun createRoute(cardId: String): String {
        return "$routePrefix/$cardId"
    }
}
