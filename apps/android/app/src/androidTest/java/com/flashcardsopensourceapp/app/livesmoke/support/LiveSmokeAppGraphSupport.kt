package com.flashcardsopensourceapp.app.livesmoke.support

import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.di.AppGraph

internal fun LiveSmokeContext.appGraph(): AppGraph {
    return (composeRule.activity.application as FlashcardsApplication).appGraph
}
