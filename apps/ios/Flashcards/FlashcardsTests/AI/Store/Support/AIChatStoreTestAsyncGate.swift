extension AIChatStoreTestSupport {
    /// One-shot suspension primitive used by the test fakes to inject races at
    /// known async boundaries (loadBootstrap, runLinkedSync, stopRun).
    ///
    /// Usage convention across the fakes: the property holding the gate is
    /// read with `if let gate = self.gateField`, awaited via `gate.wait()`,
    /// and then that property is cleared to nil so that subsequent calls to
    /// the same fake method pass through unblocked. The nil-out is
    /// intentional — tests typically only need to gate the first call. If a
    /// future test needs to gate every call, omit the nil-out at the call
    /// site rather than changing this type.
    actor AsyncGate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var isReleased: Bool

        init() {
            self.continuation = nil
            self.isReleased = false
        }

        func wait() async {
            if self.isReleased {
                return
            }

            await withCheckedContinuation { continuation in
                self.continuation = continuation
            }
        }

        func release() {
            self.isReleased = true
            self.continuation?.resume()
            self.continuation = nil
        }
    }
}
