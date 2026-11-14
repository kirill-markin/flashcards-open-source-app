import Foundation

/// Minutes to clear the due cards: the one multiplication a widget does, due cards × the server's seconds per due
/// card. Nil at 0 due; any due card reads as at least a minute.
func makeReviewTimeEstimateMinutes(dueCount: Int, secondsPerDueCard: Double) -> Int? {
    guard dueCount > 0 else {
        return nil
    }
    return max(1, Int((Double(dueCount) * secondsPerDueCard / 60).rounded()))
}

/// Whole minutes of studied time; nil when they round to 0, so the line is hidden instead of reading "≈ 0 min".
func makeStudyTimeMinutes(seconds: Double) -> Int? {
    let minutes = Int((seconds / 60).rounded())
    return minutes > 0 ? minutes : nil
}
