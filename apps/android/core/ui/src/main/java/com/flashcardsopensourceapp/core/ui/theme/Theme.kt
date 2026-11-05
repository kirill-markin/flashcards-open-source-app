package com.flashcardsopensourceapp.core.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

enum class FlashcardsAppearance {
    DARK,
    LIGHT
}

/** The appearance of the enclosing [FlashcardsTheme], for colors that differ between Dark and Light. */
val LocalFlashcardsAppearance: ProvidableCompositionLocal<FlashcardsAppearance> = staticCompositionLocalOf {
    error("LocalFlashcardsAppearance is read outside FlashcardsTheme.")
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
    tertiary = FlashcardsOrange,
    // Primary, secondary and tertiary containers stay neutral gray instead of Material's default lavender and pink.
    primaryContainer = FlashcardsLightSecondaryContainer,
    onPrimaryContainer = FlashcardsLightOnSurface,
    secondaryContainer = FlashcardsLightSecondaryContainer,
    onSecondaryContainer = FlashcardsLightOnSurface,
    tertiaryContainer = FlashcardsLightSecondaryContainer,
    onTertiaryContainer = FlashcardsLightOnSurface,
    background = FlashcardsLightBackground,
    onBackground = FlashcardsLightOnSurface,
    surface = FlashcardsLightSurface,
    onSurface = FlashcardsLightOnSurface,
    surfaceVariant = FlashcardsLightSurfaceVariant,
    onSurfaceVariant = FlashcardsLightOnSurfaceVariant,
    outline = FlashcardsLightOutline,
    outlineVariant = FlashcardsLightOutlineVariant,
    inverseSurface = FlashcardsLightInverseSurface,
    inverseOnSurface = FlashcardsLightInverseOnSurface,
    surfaceBright = FlashcardsLightSurface,
    surfaceDim = FlashcardsLightSurfaceDim,
    // Cards sit on the gray background as white, like list rows; High and Highest stay gray for content inside them.
    surfaceContainerLowest = FlashcardsLightSurface,
    surfaceContainerLow = FlashcardsLightSurface,
    surfaceContainer = FlashcardsLightSurface,
    surfaceContainerHigh = FlashcardsLightSurfaceContainerHigh,
    surfaceContainerHighest = FlashcardsLightSurfaceContainerHighest
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
    CompositionLocalProvider(LocalFlashcardsAppearance provides appearance) {
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
}
