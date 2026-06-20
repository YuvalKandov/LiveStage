import Foundation

/// Minimal debug logging for best-effort background work (the analytics pipeline). Public SDK errors
/// still surface as thrown `LiveStageError`s; this is only for things that must not break the app —
/// e.g. a failed analytics persist or a quarantined corrupt queue file — where crashing or throwing
/// to the caller would be worse than a logged, recoverable degradation.
enum LiveStageLog {
    static func debug(_ message: @autoclosure () -> String) {
        #if DEBUG
        print("[LiveStage] \(message())")
        #endif
    }
}
