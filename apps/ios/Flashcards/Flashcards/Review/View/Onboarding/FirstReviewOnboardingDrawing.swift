import SwiftUI

let firstReviewPencilContrastWidth: CGFloat = 3

struct FirstReviewPencilMark {
    let path: Path
    let opacity: Double
    let lineWidth: CGFloat?
}

private struct FirstReviewPencilRandom {
    var bits: UInt32

    mutating func next() -> Double {
        self.bits ^= self.bits << 13
        self.bits ^= self.bits >> 17
        self.bits ^= self.bits << 5
        return Double(self.bits) / 4_294_967_296
    }
}

private func sampleFirstReviewCubic(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint, _ d: CGPoint) -> [CGPoint] {
    let length = hypot(b.x - a.x, b.y - a.y) + hypot(c.x - b.x, c.y - b.y) + hypot(d.x - c.x, d.y - c.y)
    let count = max(2, Int(ceil(length / 0.85)))
    return (0...count).map { index in
        let t = CGFloat(index) / CGFloat(count)
        let u = 1 - t
        return CGPoint(
            x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
            y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y
        )
    }
}

private func firstReviewOblong(target: CGRect, frame: Int) -> [CGPoint] {
    let bounds = target.insetBy(dx: -11.5, dy: -11.5)
    let x = bounds.minX + (frame == 0 ? 0 : -0.7)
    let y = bounds.minY + (frame == 0 ? 0 : 0.8)
    let w = bounds.width
    let h = bounds.height
    let right = x + w + (frame == 0 ? 0 : 1.2)
    let bottom = y + h + (frame == 0 ? 0 : -0.3)
    let r = min(target.height / 2 + 18, w * 0.45, h * 0.45)
    let k: CGFloat = 0.55228475
    let curves: [[CGPoint]] = [
        [.init(x: x+r, y: y), .init(x: x+w*0.4, y: y-6), .init(x: x+w*0.7, y: y-4), .init(x: right-r, y: y)],
        [.init(x: right-r, y: y), .init(x: right-r+r*k, y: y), .init(x: right, y: y+r-r*k), .init(x: right, y: y+r)],
        [.init(x: right, y: y+r), .init(x: right+0.7, y: y+h*0.45), .init(x: right+0.3, y: y+h*0.65), .init(x: right, y: bottom-r)],
        [.init(x: right, y: bottom-r), .init(x: right, y: bottom-r+r*k), .init(x: right-r+r*k, y: bottom), .init(x: right-r, y: bottom)],
        [.init(x: right-r, y: bottom), .init(x: x+w*0.7, y: bottom+4), .init(x: x+w*0.3, y: bottom+6), .init(x: x+r, y: bottom)],
        [.init(x: x+r, y: bottom), .init(x: x+r-r*k, y: bottom), .init(x: x, y: bottom-r+r*k), .init(x: x, y: bottom-r)],
        [.init(x: x, y: bottom-r), .init(x: x-0.7, y: y+h*0.65), .init(x: x-0.3, y: y+h*0.4), .init(x: x, y: y+r)],
        [.init(x: x, y: y+r), .init(x: x, y: y+r-r*k), .init(x: x+r-r*k, y: y), .init(x: x+r, y: y)],
        [.init(x: x+r, y: y), .init(x: x+r+5, y: y-0.7), .init(x: x+r+10, y: y-1.2), .init(x: min(right-r, x+r+15), y: y-1.3)]
    ]
    return curves.flatMap { sampleFirstReviewCubic($0[0], $0[1], $0[2], $0[3]) }
}

private func firstReviewPencilMarks(
    points: [CGPoint], apex: CGPoint?, random: inout FirstReviewPencilRandom
) -> [FirstReviewPencilMark] {
    var marks: [FirstReviewPencilMark] = []
    guard points.count > 2 else { return marks }
    for index in 1..<(points.count - 1) {
        let previous = points[index - 1]
        let next = points[index + 1]
        let length = hypot(next.x - previous.x, next.y - previous.y)
        if length < 0.01 { continue }
        let tangent = CGPoint(x: (next.x - previous.x) / length, y: (next.y - previous.y) / length)
        let normal = CGPoint(x: -tangent.y, y: tangent.x)
        let point = points[index]
        let taper = apex.map { max(0.16, min(1, hypot(point.x - $0.x, point.y - $0.y) / 11)) } ?? 1
        let pressure = (0.78 + 0.13 * sin(Double(index) * 0.062) + random.next() * 0.19) * taper
        let drift = (sin(Double(index) * 0.12) * 0.5 + (random.next() - 0.5) * 0.7) * taper
        for strand in 0..<4 {
            if random.next() < 0.14 { continue }
            let across = (Double(strand) / 3 - 0.5) * 6.5 * pressure + drift + (random.next() - 0.5) * 1.2 * taper
            let center = CGPoint(x: point.x + normal.x * across, y: point.y + normal.y * across)
            let nibLength = (1.1 + random.next() * 2.4) * (0.35 + 0.65 * taper)
            let nibWidth = (0.35 + random.next() * 0.85) * taper
            let chip = random.next() * 0.6
            let opacity = 0.38 + random.next() * 0.57
            var path = Path()
            path.move(to: CGPoint(x: center.x-tangent.x*nibLength, y: center.y-tangent.y*nibLength))
            path.addLine(to: CGPoint(x: center.x+normal.x*nibWidth-tangent.x*chip, y: center.y+normal.y*nibWidth-tangent.y*chip))
            path.addLine(to: CGPoint(x: center.x+tangent.x*nibLength+normal.x*nibWidth*0.4, y: center.y+tangent.y*nibLength+normal.y*nibWidth*0.4))
            path.addLine(to: CGPoint(x: center.x+tangent.x*nibLength*0.6-normal.x*nibWidth, y: center.y+tangent.y*nibLength*0.6-normal.y*nibWidth))
            path.addLine(to: CGPoint(x: center.x-tangent.x*nibLength*0.8-normal.x*nibWidth*0.6, y: center.y-tangent.y*nibLength*0.8-normal.y*nibWidth*0.6))
            path.closeSubpath()
            marks.append(FirstReviewPencilMark(path: path, opacity: opacity, lineWidth: nil))
        }
        if index % 7 == 0 && random.next() > 0.3 && taper > 0.85 {
            let across = (random.next() - 0.5) * 6.5
            let opacity = 0.25 + random.next() * 0.4
            let width = 0.35 + random.next() * 0.35
            var path = Path()
            path.move(to: CGPoint(x: point.x+normal.x*across, y: point.y+normal.y*across))
            for run in 1..<min(8, points.count-index) {
                path.addLine(to: CGPoint(x: points[index+run].x+normal.x*across, y: points[index+run].y+normal.y*across))
            }
            marks.append(FirstReviewPencilMark(path: path, opacity: opacity, lineWidth: width))
        }
    }
    return marks
}

private func firstReviewOutlineTransform(
    marks: [FirstReviewPencilMark], target: CGRect, size: CGSize, neighboringButtons: [CGRect]
) -> CGAffineTransform {
    let bounds = marks.reduce(CGRect.null) { bounds, mark in
        let strokeInset = (mark.lineWidth ?? 0) / 2
        return bounds.union(mark.path.boundingRect.insetBy(dx: -strokeInset, dy: -strokeInset))
    }
    let contrastInset = firstReviewPencilContrastWidth / 2
    let edgeInset: CGFloat = 2
    var radiusX = min(bounds.width / 2, target.midX - edgeInset - contrastInset,
                      size.width - target.midX - edgeInset - contrastInset)
    var radiusY = min(bounds.height / 2, target.midY - edgeInset - contrastInset,
                      size.height - target.midY - edgeInset - contrastInset)
    for neighbor in neighboringButtons {
        if neighbor.minX >= target.maxX {
            radiusX = min(radiusX, neighbor.minX - target.midX - edgeInset - contrastInset)
        } else if neighbor.maxX <= target.minX {
            radiusX = min(radiusX, target.midX - neighbor.maxX - edgeInset - contrastInset)
        }
        if neighbor.minY >= target.maxY {
            radiusY = min(radiusY, neighbor.minY - target.midY - edgeInset - contrastInset)
        } else if neighbor.maxY <= target.minY {
            radiusY = min(radiusY, target.midY - neighbor.maxY - edgeInset - contrastInset)
        }
    }
    // Fit the entire textured stroke and its contrast rim about the actual button center.
    let scaleX = max(0, radiusX) * 2 / bounds.width
    let scaleY = max(0, radiusY) * 2 / bounds.height
    return CGAffineTransform(
        a: scaleX, b: 0, c: 0, d: scaleY,
        tx: target.midX - bounds.midX * scaleX, ty: target.midY - bounds.midY * scaleY
    )
}

func makeFirstReviewOnboardingDrawing(
    target: CGRect, size: CGSize, neighboringButtons: [CGRect], frame: Int
) -> [FirstReviewPencilMark] {
    var random = FirstReviewPencilRandom(bits: frame == 0 ? 7823 : 48191)
    let wobble: CGFloat = frame == 0 ? 0 : 1.5
    let wide = target.width > target.height * 2
    let tipX = target.minX + target.width * (wide ? 0.63 : 0.5) + wobble
    let originalOutline = firstReviewOblong(target: target, frame: frame)
    let originalMarks = firstReviewPencilMarks(points: originalOutline, apex: nil, random: &random)
    let transform = firstReviewOutlineTransform(
        marks: originalMarks, target: target, size: size, neighboringButtons: neighboringButtons
    )
    let outline = originalOutline.map { $0.applying(transform) }
    var marks = originalMarks.map { mark in
        FirstReviewPencilMark(
            path: mark.path.applying(transform), opacity: mark.opacity,
            lineWidth: mark.lineWidth.map { $0 * min(transform.a, transform.d) }
        )
    }
    guard let ringTop = outline.filter({ abs($0.x-tipX) < 10 }).map(\.y).min() else { return marks }
    let apex = CGPoint(x: tipX, y: ringTop - 17.5)
    // Ten points contain the widest pencil dab and its contrast rim.
    let arrowInset: CGFloat = 10
    guard apex.y > arrowInset + 26 else { return marks }
    let tailY = max(arrowInset + 7, apex.y - 94)
    let tailX = min(size.width - 25, tipX + (wide ? 53 : 96))
    let bendX = max(15, tipX - (wide ? 28 : 16))
    let arrow = sampleFirstReviewCubic(
        CGPoint(x: tailX, y: tailY+wobble), CGPoint(x: bendX+wobble, y: max(arrowInset, tailY-7)),
        CGPoint(x: apex.x, y: max(arrowInset, apex.y-33)), apex
    )
    marks += firstReviewPencilMarks(points: arrow, apex: apex, random: &random)
    for side in [CGFloat(-1), CGFloat(1)] {
        let angle: CGFloat = side == -1 ? 0.61 : 0.635
        let length: CGFloat = side == -1 ? 26 : 26-wobble*0.4
        let leg = CGPoint(x: apex.x+side*length*sin(angle), y: apex.y-length*cos(angle))
        marks += firstReviewPencilMarks(points: sampleFirstReviewCubic(leg, leg, apex, apex), apex: apex, random: &random)
    }
    return marks
}
