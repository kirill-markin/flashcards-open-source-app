package com.flashcardsopensourceapp.core.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.floor
import kotlin.math.pow

private const val minimumContrastAgainstWhite: Double = 3.0
private const val darkeningSearchSteps: Int = 24

private data class RgbChannels(val red: Int, val green: Int, val blue: Int)

/** The shade of an accent color painted in [appearance]; the saved color itself never changes. */
fun displayedAccentColor(color: Color, appearance: FlashcardsAppearance): Color {
    return when (appearance) {
        FlashcardsAppearance.DARK -> color
        FlashcardsAppearance.LIGHT -> darkenAccentForLightTheme(color = color)
    }
}

/** The color darkened only as far as 3:1 contrast against white; a passing color is returned unchanged. */
private fun darkenAccentForLightTheme(color: Color): Color {
    val argb = color.toArgb()
    val channels = RgbChannels(red = (argb shr 16) and 255, green = (argb shr 8) and 255, blue = argb and 255)
    if (contrastAgainstWhite(channels = channels) >= minimumContrastAgainstWhite) {
        return color
    }
    var passingFactor = 0.0
    var failingFactor = 1.0
    repeat(darkeningSearchSteps) {
        val factor = (passingFactor + failingFactor) / 2.0
        if (contrastAgainstWhite(channels = scaleChannels(channels = channels, factor = factor)) >= minimumContrastAgainstWhite) {
            passingFactor = factor
        } else {
            failingFactor = factor
        }
    }
    val darkened = scaleChannels(channels = channels, factor = passingFactor)
    return Color(red = darkened.red, green = darkened.green, blue = darkened.blue)
}

// Scaling every channel by one factor moves the color toward black and keeps its hue.
private fun scaleChannels(channels: RgbChannels, factor: Double): RgbChannels {
    return RgbChannels(
        red = floor(channels.red * factor).toInt(),
        green = floor(channels.green * factor).toInt(),
        blue = floor(channels.blue * factor).toInt()
    )
}

private fun contrastAgainstWhite(channels: RgbChannels): Double {
    return 1.05 / (relativeLuminance(channels = channels) + 0.05)
}

// WCAG 2 relative luminance.
private fun relativeLuminance(channels: RgbChannels): Double {
    return 0.2126 * linearChannel(channel = channels.red) +
        0.7152 * linearChannel(channel = channels.green) +
        0.0722 * linearChannel(channel = channels.blue)
}

private fun linearChannel(channel: Int): Double {
    val value = channel / 255.0
    return if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
}
