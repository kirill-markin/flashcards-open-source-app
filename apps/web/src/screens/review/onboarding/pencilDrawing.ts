type Point = readonly [number, number];

function seededRandom(seed: number): () => number {
  let bits = seed >>> 0;
  return () => {
    bits ^= bits << 13; bits ^= bits >>> 17; bits ^= bits << 5;
    return (bits >>> 0) / 4294967296;
  };
}
function sampleCubic(start: Point, controlA: Point, controlB: Point, end: Point): ReadonlyArray<Point> {
  const length = Math.hypot(controlA[0] - start[0], controlA[1] - start[1]) + Math.hypot(controlB[0] - controlA[0], controlB[1] - controlA[1]) + Math.hypot(end[0] - controlB[0], end[1] - controlB[1]);
  const count = Math.max(2, Math.ceil(length / .85));
  return Array.from({ length: count + 1 }, (_, index): Point => {
    const t = index / count;
    const u = 1 - t;
    return [u ** 3 * start[0] + 3 * u ** 2 * t * controlA[0] + 3 * u * t ** 2 * controlB[0] + t ** 3 * end[0], u ** 3 * start[1] + 3 * u ** 2 * t * controlA[1] + 3 * u * t ** 2 * controlB[1] + t ** 3 * end[1]];
  });
}
function sampleLine(start: Point, end: Point): ReadonlyArray<Point> {
  return sampleCubic(start, start, end, end);
}
function oblongOutline(left: number, top: number, width: number, height: number, radius: number, frame: number): ReadonlyArray<Point> {
  const x = left + (frame === 0 ? 0 : -.7);
  const y = top + (frame === 0 ? 0 : .8);
  const right = x + width + (frame === 0 ? 0 : 1.2);
  const bottom = y + height + (frame === 0 ? 0 : -.3);
  const r = Math.min(radius + 6.5, width * .45, height * .45);
  const k = .55228475;
  return [
    ...sampleCubic([x + r, y], [x + width * .4, y - 6], [x + width * .7, y - 4], [right - r, y]),
    ...sampleCubic([right - r, y], [right - r + r * k, y], [right, y + r - r * k], [right, y + r]),
    ...sampleCubic([right, y + r], [right + .7, y + height * .45], [right + .3, y + height * .65], [right, bottom - r]),
    ...sampleCubic([right, bottom - r], [right, bottom - r + r * k], [right - r + r * k, bottom], [right - r, bottom]),
    ...sampleCubic([right - r, bottom], [x + width * .7, bottom + 4], [x + width * .3, bottom + 6], [x + r, bottom]),
    ...sampleCubic([x + r, bottom], [x + r - r * k, bottom], [x, bottom - r + r * k], [x, bottom - r]),
    ...sampleCubic([x, bottom - r], [x - .7, y + height * .65], [x - .3, y + height * .4], [x, y + r]),
    ...sampleCubic([x, y + r], [x, y + r - r * k], [x + r - r * k, y], [x + r, y]),
    ...sampleCubic([x + r, y], [x + r + 5, y - .7], [x + r + 10, y - 1.2], [Math.min(right - r, x + r + 15), y - 1.3])
  ];
}
function pencilStroke(context: CanvasRenderingContext2D, points: ReadonlyArray<Point>, random: () => number, width: number, pressureProfile: (point: Point) => number): void {
  const nibScale = width / 6.5;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const next = points[index + 1];
    const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]);
    if (length < .01) continue;
    const tangent = [(next[0] - previous[0]) / length, (next[1] - previous[1]) / length];
    const normal = [-tangent[1], tangent[0]];
    const taper = pressureProfile(points[index]);
    const pressure = (.78 + .13 * Math.sin(index * .062) + random() * .19) * taper;
    const drift = (Math.sin(index * .12) * .5 + (random() - .5) * .7) * taper * nibScale;
    for (let strand = 0; strand < 4; strand += 1) {
      if (random() < .14) continue;
      const across = ((strand / 3 - .5) * width * pressure) + drift + (random() - .5) * 1.2 * taper * nibScale;
      const centerX = points[index][0] + normal[0] * across;
      const centerY = points[index][1] + normal[1] * across;
      const nibLength = (1.1 + random() * 2.4) * (.35 + .65 * taper) * nibScale;
      const nibWidth = (.35 + random() * .85) * taper * nibScale;
      const chip = random() * .6 * nibScale;
      context.globalAlpha = .38 + random() * .57;
      context.beginPath();
      context.moveTo(centerX - tangent[0] * nibLength, centerY - tangent[1] * nibLength);
      context.lineTo(centerX + normal[0] * nibWidth - tangent[0] * chip, centerY + normal[1] * nibWidth - tangent[1] * chip);
      context.lineTo(centerX + tangent[0] * nibLength + normal[0] * nibWidth * .4, centerY + tangent[1] * nibLength + normal[1] * nibWidth * .4);
      context.lineTo(centerX + tangent[0] * nibLength * .6 - normal[0] * nibWidth, centerY + tangent[1] * nibLength * .6 - normal[1] * nibWidth);
      context.lineTo(centerX - tangent[0] * nibLength * .8 - normal[0] * nibWidth * .6, centerY - tangent[1] * nibLength * .8 - normal[1] * nibWidth * .6);
      context.closePath();
      context.fill();
    }
    if (index % 7 === 0 && random() > .3 && taper > .85) {
      const across = (random() - .5) * width;
      context.globalAlpha = .25 + random() * .4;
      context.lineWidth = (.35 + random() * .35) * nibScale;
      context.beginPath();
      context.moveTo(points[index][0] + normal[0] * across, points[index][1] + normal[1] * across);
      for (let run = 1; run < 8 && index + run < points.length; run += 1) context.lineTo(points[index + run][0] + normal[0] * across, points[index + run][1] + normal[1] * across);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

export type PencilGuideRect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

export type PencilGuideBounds = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  surfaceWidth: number;
  surfaceHeight: number;
  contentBounds: ReadonlyArray<PencilGuideRect>;
  controlBounds: ReadonlyArray<PencilGuideRect>;
}>;

// Covers the polygon nib, strand drift and both complete-frame contrast shadows.
const strokeInset = 14;
// Includes the scaled nib and three blur radii from each full-frame contrast shadow.
const compactStrokeInset = 8.5;

function fitLoop(outline: ReadonlyArray<Point>, bounds: PencilGuideBounds): ReadonlyArray<Point> {
  const minX = Math.min(...outline.map((point) => point[0]));
  const maxX = Math.max(...outline.map((point) => point[0]));
  const minY = Math.min(...outline.map((point) => point[1]));
  const maxY = Math.max(...outline.map((point) => point[1]));
  const outlineCenterX = (minX + maxX) / 2;
  const outlineCenterY = (minY + maxY) / 2;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const desiredHalfWidth = (maxX - minX) / 2;
  const desiredHalfHeight = (maxY - minY) / 2;
  let availableLeft = 0;
  let availableTop = 0;
  let availableRight = bounds.surfaceWidth;
  let availableBottom = bounds.surfaceHeight;
  for (const control of bounds.controlBounds) {
    if (control.top < centerY + desiredHalfHeight + strokeInset
      && control.bottom > centerY - desiredHalfHeight - strokeInset) {
      if (control.right <= bounds.left) availableLeft = Math.max(availableLeft, control.right);
      if (control.left >= bounds.left + bounds.width) availableRight = Math.min(availableRight, control.left);
    }
    if (control.left < centerX + desiredHalfWidth + strokeInset
      && control.right > centerX - desiredHalfWidth - strokeInset) {
      if (control.bottom <= bounds.top) availableTop = Math.max(availableTop, control.bottom);
      if (control.top >= bounds.top + bounds.height) availableBottom = Math.min(availableBottom, control.top);
    }
  }
  const halfWidth = Math.min(desiredHalfWidth, centerX - availableLeft - strokeInset, availableRight - centerX - strokeInset);
  const halfHeight = Math.min(desiredHalfHeight, centerY - availableTop - strokeInset, availableBottom - centerY - strokeInset);
  return outline.map(([x, y]): Point => [
    centerX + (x - outlineCenterX) * halfWidth / desiredHalfWidth,
    centerY + (y - outlineCenterY) * halfHeight / desiredHalfHeight,
  ]);
}

type ArrowRoute = Readonly<{
  apex: Point;
  shaft: ReadonlyArray<Point>;
  legA: ReadonlyArray<Point>;
  legB: ReadonlyArray<Point>;
  width: number;
  inset: number;
}>;

function arrowFits(route: ArrowRoute, bounds: PencilGuideBounds): boolean {
  const occupied = [...bounds.contentBounds, ...bounds.controlBounds];
  return [route.shaft, route.legA, route.legB].every((stroke) => stroke.every(([x, y]) =>
    x >= route.inset && x <= bounds.surfaceWidth - route.inset
    && y >= route.inset && y <= bounds.surfaceHeight - route.inset
    && !occupied.some((rect) => x > rect.left - route.inset && x < rect.right + route.inset
      && y > rect.top - route.inset && y < rect.bottom + route.inset)));
}

function standardArrow(apex: Point, direction: number, scale: number, tailOffset: number, wobble: number): ArrowRoute {
  const tailY = apex[1] - 94 * scale;
  const headLength = 26 * scale;
  return {
    apex,
    shaft: sampleCubic([apex[0] + direction * tailOffset * scale, tailY + wobble],
      [apex[0] - direction * 28 * scale + wobble, tailY - 7 * scale],
      [apex[0], apex[1] - 33 * scale], apex),
    legA: sampleLine([apex[0] - headLength * Math.sin(.61), apex[1] - headLength * Math.cos(.61)], apex),
    legB: sampleLine([apex[0] + (headLength - wobble * .4) * Math.sin(.635),
      apex[1] - (headLength - wobble * .4) * Math.cos(.635)], apex),
    width: 6.5,
    inset: strokeInset,
  };
}

function chooseArrowRoute(bounds: PencilGuideBounds, outline: ReadonlyArray<Point>, tailOffset: number, wobble: number): ArrowRoute | null {
  for (const scale of [1, .8, .6, .45, .3]) {
    for (const fraction of [.63, .28, .78]) {
      const tipX = bounds.left + bounds.width * fraction + wobble;
      const topOfRing = Math.min(...outline.filter((point) => Math.abs(point[0] - tipX) < 10).map((point) => point[1]));
      for (const direction of [1, -1]) {
        const route = standardArrow([tipX, topOfRing - 17.5], direction, scale, tailOffset, wobble);
        if (arrowFits(route, bounds)) return route;
      }
    }
  }
  // A full-width phone rating leaves only the narrow lane beside the answer text.
  for (const side of [-1, 1]) {
    const nearbyContent = bounds.contentBounds.filter((rect) => rect.top < bounds.top && rect.bottom > bounds.top - 140);
    // The target edge is inside the lane: its rounded corner is not occupied text.
    const contentEdge = side === -1
      ? Math.min(bounds.left + bounds.width, ...nearbyContent.map((rect) => rect.left))
      : Math.max(bounds.left, ...nearbyContent.map((rect) => rect.right));
    const tipX = side === -1 ? contentEdge / 2 : (contentEdge + bounds.surfaceWidth) / 2;
    const ringEdgeX = side === -1
      ? Math.min(...outline.map((point) => point[0]))
      : Math.max(...outline.map((point) => point[0]));
    const ringX = side === -1 ? Math.max(tipX, ringEdgeX) : Math.min(tipX, ringEdgeX);
    const ringTop = Math.min(...outline.filter((point) => Math.abs(point[0] - ringX) < 3).map((point) => point[1]));
    const apex: Point = [tipX, ringTop - 17.5];
    for (const length of [64, 48, 36]) {
      const route: ArrowRoute = {
        apex,
        shaft: sampleCubic([tipX + side * .7, apex[1] - length + wobble * .3],
          [tipX - side * 1.2, apex[1] - length - 2], [tipX, apex[1] - 22], apex),
        legA: sampleLine([tipX - 13 * Math.sin(.18), apex[1] - 13 * Math.cos(.18)], apex),
        legB: sampleLine([tipX + 13 * Math.sin(.18), apex[1] - 13 * Math.cos(.18) + wobble * .2], apex),
        width: 2,
        inset: compactStrokeInset,
      };
      if (arrowFits(route, bounds)) return route;
    }
  }
  return null;
}

export function drawPencilGuide(
  context: CanvasRenderingContext2D,
  bounds: PencilGuideBounds,
  accent: string,
  frame: number,
): void {
  const { left, top, width, height, radius } = bounds;
  const padding = 11.5;
  const random = seededRandom(frame === 0 ? 7823 : 48191);
  const wobble = frame === 0 ? 0 : 1.5;
  context.fillStyle = accent;
  context.strokeStyle = accent;
  const outline = fitLoop(oblongOutline(left - padding, top - padding, width + padding * 2, height + padding * 2, radius + padding, frame), bounds);
  pencilStroke(context, outline, random, 6.5, () => 1);
  const tailOffset = width > height * 2 ? 53 : 96;
  const route = chooseArrowRoute(bounds, outline, tailOffset, wobble);
  if (route === null) return;
  const { apex: arrowApex } = route;
  const tipPressure = (point: Point): number => Math.max(.16, Math.min(1, Math.hypot(point[0] - arrowApex[0], point[1] - arrowApex[1]) / 11));
  pencilStroke(context, route.shaft, random, route.width, tipPressure);
  pencilStroke(context, route.legA, random, route.width, tipPressure);
  pencilStroke(context, route.legB, random, route.width, tipPressure);
}
