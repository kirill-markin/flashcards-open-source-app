package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.updateAll
import com.flashcardsopensourceapp.app.di.AppGraph
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce

private const val widgetUpdateDebounceMillis: Long = 1_000L

/** One instance of every widget class the manifest declares. */
private fun makeAllWidgets(): List<GlanceAppWidget> {
    return listOf(
        ReviewWidget(),
        ReviewsChartWidget(),
        ComingUpWidget(),
        TodayWidget(),
        ActivityWidget(),
        YearWidget(),
        StreaksWidget(),
        MonthCalendarWidget(),
        DashboardWidget(),
        QuestionWidget()
    )
}

@OptIn(FlowPreview::class)
internal suspend fun updateWidgetsOnContentChange(context: Context, appGraph: AppGraph) {
    val widgets: List<GlanceAppWidget> = makeAllWidgets()
    observeStyledWidgetContent(appGraph = appGraph, content = observeWidgetContent(appGraph = appGraph))
        .debounce(timeoutMillis = widgetUpdateDebounceMillis)
        .collectLatest {
            widgets.forEach { widget ->
                widget.updateAll(context = context)
            }
        }
}
