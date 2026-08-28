package com.flashcardsopensourceapp.core.ui

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Whether the app's single hosting Activity is currently started.
 *
 * It exists so a `ViewModel` can tell a person leaving a screen from the system taking that screen
 * away, because both clear the same `ViewModelStore` and produce an identical `onCleared()`:
 * `NavController` clears a popped back stack entry's store, and `ComponentActivity` clears the store
 * that owns every entry on a non-configuration `ON_DESTROY` — which the "Don't keep activities"
 * developer setting and some OEM background-destroy behaviour trigger with the process still alive.
 * Only the person's departure can happen while the Activity is started.
 *
 * Process-scoped rather than held on the app graph, because the graph is torn down and rebuilt
 * inside a running process while the Activity keeps running, and there is exactly one Activity.
 * `ProcessLifecycleOwner` is deliberately not the source: it debounces its stop by 700 ms to absorb
 * configuration changes, and "Don't keep activities" destroys the Activity well inside that window.
 */
private val hostActivityStartedState = AtomicBoolean(false)

fun markHostActivityStarted() {
    hostActivityStartedState.set(true)
}

fun markHostActivityStopped() {
    hostActivityStartedState.set(false)
}

fun isHostActivityStarted(): Boolean {
    return hostActivityStartedState.get()
}
