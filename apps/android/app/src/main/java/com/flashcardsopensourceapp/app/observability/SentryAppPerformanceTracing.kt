package com.flashcardsopensourceapp.app.observability

import com.flashcardsopensourceapp.core.observability.AppPerformanceSpan
import com.flashcardsopensourceapp.core.observability.AppPerformanceSpanName
import com.flashcardsopensourceapp.core.observability.AppPerformanceTracing
import io.sentry.ISpan
import io.sentry.Sentry

private const val performanceSpanOperation: String = "ui.review"
private const val performanceSpanPlatform: String = "android"

class SentryAppPerformanceTracing : AppPerformanceTracing {
    override fun startSpan(name: AppPerformanceSpanName): AppPerformanceSpan {
        val transaction = Sentry.startTransaction(name.spanName, performanceSpanOperation)
        transaction.setData("platform", performanceSpanPlatform)
        return SentryAppPerformanceSpan(span = transaction)
    }
}

private class SentryAppPerformanceSpan(
    private val span: ISpan
) : AppPerformanceSpan {
    override fun setAttribute(key: String, value: Boolean) {
        span.setData(key, value)
    }

    override fun setAttribute(key: String, value: Long) {
        span.setData(key, value)
    }

    override fun finish() {
        span.finish()
    }
}
