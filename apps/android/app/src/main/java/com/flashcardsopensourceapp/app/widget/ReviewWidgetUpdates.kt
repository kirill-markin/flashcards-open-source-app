package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce

private const val reviewWidgetUpdateDebounceMillis: Long = 1_000L

/**
 * Re-renders every placed widget when its content changes: reviews, syncs, Review filter and
 * workspace changes, and cards falling due. `updateAll` does nothing while no widget is placed.
 */
@OptIn(FlowPreview::class)
suspend fun updateReviewWidgetsOnContentChange(context: Context, content: Flow<ReviewWidgetContent?>) {
    content.debounce(timeoutMillis = reviewWidgetUpdateDebounceMillis).collectLatest {
        ReviewWidget().updateAll(context = context)
    }
}
