import SwiftUI

extension ReviewReactionRenderer {
    static let reducedMotionDurationSeconds: Double = 0.34
    private static let reducedMotionDrawingProgress: CGFloat = 0.55

    struct ReviewReactionPhaseProgress {
        let enter: CGFloat
        let hold: CGFloat
        let exit: CGFloat
    }

    static func reviewReactionPhaseProgress(
        progress: CGFloat,
        enterEnd: CGFloat,
        exitStart: CGFloat
    ) -> ReviewReactionPhaseProgress {
        precondition(enterEnd > 0, "Review reaction enter phase must be positive.")
        precondition(exitStart > enterEnd, "Review reaction exit phase must start after enter phase.")
        precondition(exitStart < 1, "Review reaction exit phase must start before progress completes.")

        let boundedProgress = reviewReactionClampedProgress(progress: progress)
        return ReviewReactionPhaseProgress(
            enter: reviewReactionClampedProgress(progress: boundedProgress / enterEnd),
            hold: reviewReactionClampedProgress(progress: (boundedProgress - enterEnd) / (exitStart - enterEnd)),
            exit: reviewReactionClampedProgress(progress: (boundedProgress - exitStart) / (1 - exitStart))
        )
    }

    static func reviewReactionClampedProgress(progress: CGFloat) -> CGFloat {
        min(max(progress, 0), 1)
    }

    static func reviewReactionDrawingProgress(
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) -> CGFloat {
        switch motionMode {
        case .standard:
            return reviewReactionClampedProgress(progress: progress)
        case .reduced:
            return reducedMotionDrawingProgress
        }
    }

    static func reviewReactionOpacity(progress: CGFloat) -> Double {
        let fadeIn = min(progress / 0.10, 1)
        let fadeOut = min((1 - progress) / 0.22, 1)
        return Double(max(0, min(fadeIn, fadeOut)))
    }

    static func reviewReactionEaseOutCubic(progress: CGFloat) -> CGFloat {
        let inverse = 1 - reviewReactionClampedProgress(progress: progress)
        return 1 - inverse * inverse * inverse
    }

    static func reviewReactionEaseInCubic(progress: CGFloat) -> CGFloat {
        let boundedProgress = reviewReactionClampedProgress(progress: progress)
        return boundedProgress * boundedProgress * boundedProgress
    }

    static func reviewReactionEaseInOut(progress: CGFloat) -> CGFloat {
        let boundedProgress = reviewReactionClampedProgress(progress: progress)
        return -(cos(CGFloat.pi * boundedProgress) - 1) / 2
    }

    static func reviewReactionEaseOutBack(progress: CGFloat, overshoot: CGFloat) -> CGFloat {
        let boundedProgress = reviewReactionClampedProgress(progress: progress)
        let shiftedProgress = boundedProgress - 1
        return 1 + (overshoot + 1) * shiftedProgress * shiftedProgress * shiftedProgress + overshoot * shiftedProgress * shiftedProgress
    }

    static func reviewReactionPopScale(
        progress: CGFloat,
        enterEnd: CGFloat,
        exitStart: CGFloat,
        baseScale: CGFloat,
        peakScale: CGFloat,
        settledScale: CGFloat
    ) -> CGFloat {
        let phase = reviewReactionPhaseProgress(
            progress: progress,
            enterEnd: enterEnd,
            exitStart: exitStart
        )
        if phase.enter < 1 {
            let scale = reviewReactionInterpolate(
                start: baseScale,
                end: settledScale,
                progress: reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.22)
            )
            return min(scale, peakScale)
        }
        if phase.exit > 0 {
            return reviewReactionInterpolate(
                start: settledScale,
                end: settledScale * 0.82,
                progress: reviewReactionEaseInCubic(progress: phase.exit)
            )
        }

        let settlePulse = sin(phase.hold * CGFloat.pi * 4) * 0.045 * (1 - phase.hold)
        return settledScale + settlePulse
    }

    static func reviewReactionInterpolate(
        start: CGFloat,
        end: CGFloat,
        progress: CGFloat
    ) -> CGFloat {
        start + (end - start) * progress
    }
}
