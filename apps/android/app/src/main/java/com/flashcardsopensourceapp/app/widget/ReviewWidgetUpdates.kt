package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce

private const val widgetUpdateDebounceMillis: Long = 1_000L

/** One instance of every widget class the manifest declares. */
private fun makeAllWidgets(): List<GlanceAppWidget> {
    return listOf(ReviewWidget())
}

/**
 * Re-renders every placed widget of every kind when the content changes: reviews, syncs, Review
 * filter and workspace changes, cards falling due, and Progress updates. `updateAll` does nothing
 * for a kind with no placed widget.
 */
@OptIn(FlowPreview::class)
suspend fun updateWidgetsOnContentChange(context: Context, content: Flow<WidgetContent>) {
    val widgets: List<GlanceAppWidget> = makeAllWidgets()
    content.debounce(timeoutMillis = widgetUpdateDebounceMillis).collectLatest {
        widgets.forEach { widget ->
            widget.updateAll(context = context)
        }
    }
}
