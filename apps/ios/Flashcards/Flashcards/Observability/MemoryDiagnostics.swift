import Foundation

// Sampling runs on every breadcrumb; do not allocate, log, or touch Sentry.

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

// The OS jetsam limit applies to phys_footprint, not resident_size.
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

func availableMemoryBytes() -> UInt64? {
    #if targetEnvironment(macCatalyst)
    // macOS can return zero without a configured process memory limit.
    return nil
    #else
    return UInt64(os_proc_available_memory())
    #endif
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

func startAppUptimeReference(processInfo: ProcessInfo) {
    appUptimeReferenceStorage.store(systemUptime: processInfo.systemUptime)
}

func appUptimeSeconds(processInfo: ProcessInfo) -> Int? {
    guard let referenceSystemUptime: TimeInterval = appUptimeReferenceStorage.read() else {
        return nil
    }

    return Int((processInfo.systemUptime - referenceSystemUptime).rounded(.down))
}
