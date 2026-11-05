package com.flashcardsopensourceapp.core.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

enum class FlashcardsAppearance {
    DARK,
    LIGHT
}

val FlashcardsDarkColorScheme = darkColorScheme(
    primary = FlashcardsOrange,
    onPrimary = Color.Black,
    secondary = FlashcardsOrange,
    tertiary = FlashcardsOrange,
    background = FlashcardsBackground,
    onBackground = FlashcardsOnSurface,
    surface = FlashcardsSurface,
    onSurface = FlashcardsOnSurface,
    surfaceVariant = FlashcardsSurfaceVariant,
    onSurfaceVariant = FlashcardsOnSurfaceVariant
)

private val FlashcardsLightColorScheme = lightColorScheme(
    primary = FlashcardsOrange,
    onPrimary = Color.Black,
    secondary = FlashcardsOrange,
    tertiary = FlashcardsOrange
)

@Composable
fun FlashcardsTheme(content: @Composable () -> Unit) {
    FlashcardsTheme(appearance = FlashcardsAppearance.DARK, accentColor = FlashcardsOrange, content = content)
}

@Composable
fun FlashcardsTheme(appearance: FlashcardsAppearance, accentColor: Color, content: @Composable () -> Unit) {
    val colorScheme: ColorScheme = when (appearance) {
        FlashcardsAppearance.DARK -> FlashcardsDarkColorScheme
        FlashcardsAppearance.LIGHT -> FlashcardsLightColorScheme
    }
    MaterialTheme(
        colorScheme = colorScheme.copy(
            primary = accentColor,
            onPrimary = if (accentColor.luminance() > 0.179f) Color.Black else Color.White,
            secondary = accentColor,
            tertiary = accentColor
        ),
        typography = FlashcardsTypography,
        content = content
    )
}
