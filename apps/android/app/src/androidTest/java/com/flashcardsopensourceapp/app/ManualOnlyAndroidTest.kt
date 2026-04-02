package com.flashcardsopensourceapp.app

/**
 * Marks instrumentation entrypoints that should run only from explicit manual scripts.
 */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
annotation class ManualOnlyAndroidTest
