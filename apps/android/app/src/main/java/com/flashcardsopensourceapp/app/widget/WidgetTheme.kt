package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.toColorInt
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.provideContent
import androidx.glance.material3.ColorProviders
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.model.cloud.canUseLocalPremiumFeatures
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

internal data class StyledWidgetContent<T>(val content: T, val accentHex: String)

internal fun <T> observeStyledWidgetContent(appGraph: AppGraph, content: Flow<T>): Flow<StyledWidgetContent<T>> {
    val accountRepository = appGraph.cloudAccountRepository
    return combine(
        content,
        accountRepository.observeAccountPreferences(),
        accountRepository.observeEntitlement()
    ) { widgetContent, preferences, entitlement ->
        val accentHex: String = if (canUseLocalPremiumFeatures(entitlement = entitlement)) {
            preferences.accentColor
        } else {
            defaultAccentColor
        }
        StyledWidgetContent(content = widgetContent, accentHex = accentHex)
    }.distinctUntilChanged()
}

@OptIn(ExperimentalCoroutinesApi::class)
internal suspend fun <T> GlanceAppWidget.provideStyledWidgetContent(
    context: Context,
    observe: (AppGraph) -> Flow<T>,
    render: @Composable (T?) -> Unit
) {
    val application = context.applicationContext as FlashcardsApplication
    val contentFlow: Flow<StyledWidgetContent<T>?> = application.appGraphState.flatMapLatest { appGraph ->
        if (appGraph == null) {
            flowOf(null)
        } else {
            observeStyledWidgetContent(appGraph = appGraph, content = observe(appGraph))
        }
    }
    val initialContent = contentFlow.first()
    provideContent {
        val state by contentFlow.collectAsState(initial = initialContent)
        val accentHex: String = state?.accentHex ?: defaultAccentColor
        val colors = remember(accentHex) {
            val accentArgb: Int = visibleWidgetAccent(accentArgb = accentHex.toColorInt())
            ColorProviders(
                scheme = FlashcardsDarkColorScheme.copy(
                    primary = Color(accentArgb),
                    onPrimary = Color(widgetFillLabelArgb(fillArgb = accentArgb))
                )
            )
        }
        GlanceTheme(colors = colors) {
            render(state?.content)
        }
    }
}

@Composable
internal fun widgetAccentColor(): Color {
    return GlanceTheme.colors.primary.getColor(LocalContext.current)
}

private val widgetSurfaceArgb: Int = FlashcardsDarkColorScheme.surface.toArgb()
private const val widgetAccentTextContrast: Double = 4.5
private const val widgetOutlineContrast: Double = 3.0

// Keep the exact accent when it is readable; otherwise find the smallest tint that works on the widget surface.
private fun visibleWidgetAccent(accentArgb: Int): Int {
    if (ColorUtils.calculateContrast(accentArgb, widgetSurfaceArgb) >= widgetAccentTextContrast) {
        return accentArgb
    }
    val white: Int = Color.White.toArgb()
    var low = 1
    var high = 255
    while (low < high) {
        val middle: Int = (low + high) / 2
        val tint: Int = ColorUtils.blendARGB(accentArgb, white, middle / 255f)
        if (ColorUtils.calculateContrast(tint, widgetSurfaceArgb) >= widgetAccentTextContrast) {
            high = middle
        } else {
            low = middle + 1
        }
    }
    return ColorUtils.blendARGB(accentArgb, white, low / 255f)
}

internal fun widgetFillOnSurfaceArgb(fillArgb: Int): Int {
    return ColorUtils.compositeColors(fillArgb, widgetSurfaceArgb)
}

internal fun widgetFillLabelArgb(fillArgb: Int): Int {
    val fillOnSurface: Int = widgetFillOnSurfaceArgb(fillArgb = fillArgb)
    val black: Int = Color.Black.toArgb()
    val white: Int = Color.White.toArgb()
    return if (ColorUtils.calculateContrast(black, fillOnSurface) >= ColorUtils.calculateContrast(white, fillOnSurface)) {
        black
    } else {
        white
    }
}

internal fun widgetFillOutlineArgb(fillArgb: Int): Int {
    val neutral: Int = FlashcardsDarkColorScheme.onSurface.toArgb()
    return if (ColorUtils.calculateContrast(neutral, widgetFillOnSurfaceArgb(fillArgb = fillArgb)) >= widgetOutlineContrast) {
        neutral
    } else {
        Color.Black.toArgb()
    }
}
