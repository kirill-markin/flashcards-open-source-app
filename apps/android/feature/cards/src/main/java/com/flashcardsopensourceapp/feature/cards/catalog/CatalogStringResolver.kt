package com.flashcardsopensourceapp.feature.cards.catalog

import android.content.Context
import androidx.annotation.StringRes

/** Resolves catalog strings when they are shown, so they follow an app language changed while a ViewModel lives. */
interface CatalogStringResolver {
    fun get(@StringRes stringResId: Int): String
}

internal class AndroidCatalogStringResolver(
    private val context: Context
) : CatalogStringResolver {
    override fun get(@StringRes stringResId: Int): String {
        return context.getString(stringResId)
    }
}

internal fun createCatalogStringResolver(context: Context): CatalogStringResolver {
    return AndroidCatalogStringResolver(context = context.applicationContext)
}
