package com.flashcardsopensourceapp.app.observability

import com.flashcardsopensourceapp.core.observability.AppPerformanceSpan
import com.flashcardsopensourceapp.core.observability.AppPerformanceSpanName
import com.flashcardsopensourceapp.core.observability.AppPerformanceTracing

class NoopAppPerformanceTracing : AppPerformanceTracing {
    override fun startSpan(name: AppPerformanceSpanName): AppPerformanceSpan {
        return NoopAppPerformanceSpan
    }
}

private object NoopAppPerformanceSpan : AppPerformanceSpan {
    override fun setAttribute(key: String, value: Boolean) {
    }

    override fun setAttribute(key: String, value: Long) {
    }

    override fun finish() {
    }
}
