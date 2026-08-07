import Foundation

// Process diagnostics sampled on every Sentry breadcrumb.
//
// The Sentry Cocoa SDK deliberately skips frequently changing context such as
// free memory when it writes a watchdog termination event, but it does replay
// the persisted breadcrumb ring buffer onto that event. Carrying these values
// on our own breadcrumbs is therefore the only way a later
// `WatchdogTermination` can answer whether the OS killed the app for running
// out of memory. Everything here runs on every breadcrumb, so it must stay
// allocation-free, must not log, and must not touch Sentry.

private final class AppUptimeReferenceStorage: @unchecked Sendable {
    private let lock: NSLock
    private var referenceSystemUptime: TimeInterval?

    init() {
        self.lock = NSLock()
        self.referenceSystemUptime = nil
    }

    func store(systemUptime: TimeInterval) {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        self.referenceSystemUptime = systemUptime
    }

    func read() -> TimeInterval? {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }
        return self.referenceSystemUptime
    }
}

private let appUptimeReferenceStorage: AppUptimeReferenceStorage = AppUptimeReferenceStorage()

/// Bytes the process currently occupies, as reported by `phys_footprint`. This
/// is the number the Xcode memory gauge shows and the number the OS jetsam
/// limit is applied to, which is why `resident_size` is not used here.
func currentMemoryFootprintBytes() -> UInt64? {
    var info: task_vm_info_data_t = task_vm_info_data_t()
    var count: mach_msg_type_number_t = mach_msg_type_number_t(
        MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size
    )
    let capacity: Int = Int(count)
    let result: kern_return_t = withUnsafeMutablePointer(to: &info) { infoPointer in
        infoPointer.withMemoryRebound(to: integer_t.self, capacity: capacity) { integerPointer in
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), integerPointer, &count)
        }
    }
    guard result == KERN_SUCCESS else {
        return nil
    }

    return info.phys_footprint
}

/// Bytes the process may still allocate before it hits its dirty memory limit
/// and the OS terminates it. `os_proc_available_memory` documents `0` as a real
/// reading meaning the process is already over its memory limit — the single
/// strongest signal that a termination was an out-of-memory kill — so `0` is
/// reported as-is and never mapped to a missing value. (The header's other `0`
/// case, "the calling process is not an app", cannot apply to this binary.)
func availableMemoryBytes() -> UInt64 {
    return UInt64(os_proc_available_memory())
}

func currentThermalStateName(processInfo: ProcessInfo) -> String {
    switch processInfo.thermalState {
    case .nominal:
        return "nominal"
    case .fair:
        return "fair"
    case .serious:
        return "serious"
    case .critical:
        return "critical"
    @unknown default:
        return "unknown"
    }
}

/// Captures the launch reference read back by `appUptimeSeconds(processInfo:)`.
func startAppUptimeReference(processInfo: ProcessInfo) {
    appUptimeReferenceStorage.store(systemUptime: processInfo.systemUptime)
}

/// Whole seconds since `startAppUptimeReference(processInfo:)` ran, or `nil`
/// before it ran. Whole seconds are enough to separate a process that has been
/// running for hours from one that just launched.
func appUptimeSeconds(processInfo: ProcessInfo) -> Int? {
    guard let referenceSystemUptime: TimeInterval = appUptimeReferenceStorage.read() else {
        return nil
    }

    return Int((processInfo.systemUptime - referenceSystemUptime).rounded(.down))
}
