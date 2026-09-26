package com.flashcardsopensourceapp.core.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val FlashcardsDarkColorScheme = darkColorScheme(
    primary = FlashcardsOrange,
    onPrimary = FlashcardsOnSurface,
    secondary = FlashcardsOrange,
    tertiary = FlashcardsOrange,
    background = FlashcardsBackground,
    onBackground = FlashcardsOnSurface,
    surface = FlashcardsSurface,
    onSurface = FlashcardsOnSurface,
    surfaceVariant = FlashcardsSurfaceVariant,
    onSurfaceVariant = FlashcardsOnSurfaceVariant
)

@Composable
fun FlashcardsTheme(content: @Composable () -> Unit) {
    FlashcardsTheme(accentColor = FlashcardsOrange, content = content)
}

@Composable
fun FlashcardsTheme(accentColor: Color, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = FlashcardsDarkColorScheme.copy(
            primary = accentColor,
            secondary = accentColor,
            tertiary = accentColor
        ),
        typography = FlashcardsTypography,
        content = content
    )
}
