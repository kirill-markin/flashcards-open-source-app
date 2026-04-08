package com.flashcardsopensourceapp.app

/**
 * Marks instrumentation entrypoints that should stay out of default CI/CD and
 * package-level instrumentation runs, and execute only from explicit manual scripts.
 */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
annotation class ManualOnlyAndroidTest
