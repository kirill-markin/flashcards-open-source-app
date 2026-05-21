import type { CSSProperties, ReactElement } from "react";
import {
  reviewReactionAnimationDurationMillis,
  type ReviewReactionEvent,
  type ReviewReactionVariant,
} from "./reviewReaction";

type ReviewRatingReactionLayerProps = Readonly<{
  events: ReadonlyArray<ReviewReactionEvent>;
}>;

type ReviewReactionStyle = CSSProperties & Readonly<{
  "--review-reaction-duration": string;
}>;

function makeReviewReactionStyle(event: ReviewReactionEvent): ReviewReactionStyle {
  return {
    "--review-reaction-duration": `${reviewReactionAnimationDurationMillis(event.variant)}ms`,
  };
}

function makeScallopedSealPoints(
  centerX: number,
  centerY: number,
  radius: number,
  teeth: number,
  inset: number,
): string {
  const pointCount = Math.max(teeth * 2, 8);
  const points: Array<string> = [];

  for (let index = 0; index < pointCount; index += 1) {
    const pointRadius = index % 2 === 0 ? radius : radius * (1 - inset);
    const angle = (Math.PI * 2 * index) / pointCount;
    points.push(`${centerX + Math.cos(angle) * pointRadius},${centerY + Math.sin(angle) * pointRadius}`);
  }

  return points.join(" ");
}

function makeSparklePoints(
  centerX: number,
  centerY: number,
  radius: number,
  rotation: number,
): string {
  const points: Array<string> = [];

  for (let index = 0; index < 8; index += 1) {
    const pointRadius = index % 2 === 0 ? radius : radius * 0.34;
    const angle = rotation + (Math.PI * index) / 4;
    points.push(`${centerX + Math.cos(angle) * pointRadius},${centerY + Math.sin(angle) * pointRadius}`);
  }

  return points.join(" ");
}

function AgainRedScribbleSlashReaction(): ReactElement {
  return (
    <g className="review-reaction-scribble-mark">
      <path className="review-reaction-red-shadow-stroke" d="M10 26 C31 18 61 70 90 58" strokeWidth="10" />
      <path className="review-reaction-red-stroke" d="M10 26 C31 18 61 70 90 58" strokeWidth="5" />
      <path className="review-reaction-red-shadow-stroke" d="M9 40 C34 28 55 77 91 74" strokeWidth="10" />
      <path className="review-reaction-red-stroke" d="M9 40 C34 28 55 77 91 74" strokeWidth="5" />
      <path className="review-reaction-red-shadow-stroke" d="M12 14 C39 28 56 57 88 45" strokeWidth="8" />
      <path className="review-reaction-red-stroke" d="M12 14 C39 28 56 57 88 45" strokeWidth="4" />
    </g>
  );
}

function AgainRewindVortexReaction(): ReactElement {
  return (
    <g className="review-reaction-vortex-mark">
      <path className="review-reaction-red-stroke" d="M50 50 C36 36 53 22 68 31 C87 43 75 71 51 72 C24 73 14 39 34 21" strokeWidth="4" />
      <path className="review-reaction-orange-stroke" d="M49 51 C64 62 49 78 34 70 C15 60 27 32 51 29 C78 25 90 59 71 78" strokeWidth="4" />
      <path className="review-reaction-pink-stroke" d="M50 50 C52 34 72 37 75 52 C80 74 50 86 31 69 C10 50 30 18 58 18" strokeWidth="4" />
      <polygon className="review-reaction-red-fill" points="31,19 43,19 35,30" />
      <polygon className="review-reaction-orange-fill" points="72,78 60,78 68,67" />
      <polygon className="review-reaction-pink-fill" points="59,17 50,25 49,11" />
    </g>
  );
}

function AgainStampFlybyReaction(): ReactElement {
  return (
    <g className="review-reaction-stamp-mark">
      <polygon className="review-reaction-red-fill" points={makeScallopedSealPoints(50, 43, 15, 24, 0.10)} />
      <polygon className="review-reaction-white-stroke" points={makeScallopedSealPoints(50, 43, 15, 24, 0.10)} />
      <path className="review-reaction-white-stroke" d="M58 35 C47 29 36 38 39 49 C42 58 55 59 62 51" strokeWidth="5" />
      <polygon className="review-reaction-white-fill" points="40,36 31,41 39,47" />
    </g>
  );
}

function AgainWarningTapeReaction(): ReactElement {
  return (
    <g className="review-reaction-warning-tape-mark">
      <g transform="translate(50 31) rotate(-13)">
        <rect className="review-reaction-yellow-fill" x="-56" y="-5" width="112" height="10" rx="2" />
        {[-54, -36, -18, 0, 18, 36, 54].map((xPosition) => (
          <polygon key={`top-${xPosition}`} className="review-reaction-dark-fill" points={`${xPosition},-5 ${xPosition + 9},-5 ${xPosition - 1},5 ${xPosition - 10},5`} />
        ))}
      </g>
      <g transform="translate(50 59) rotate(12)">
        <rect className="review-reaction-yellow-fill" x="-54" y="-4" width="108" height="8" rx="2" />
        {[-52, -34, -16, 2, 20, 38, 56].map((xPosition) => (
          <polygon key={`bottom-${xPosition}`} className="review-reaction-dark-fill" points={`${xPosition},-4 ${xPosition + 8},-4 ${xPosition - 1},4 ${xPosition - 9},4`} />
        ))}
      </g>
    </g>
  );
}

function HardHourglassSandReaction(): ReactElement {
  return (
    <g className="review-reaction-hourglass-mark">
      <path className="review-reaction-yellow-stroke" d="M39 19 L61 19 L50 45 L61 72 L39 72 L50 45 Z" strokeWidth="3.2" />
      <path className="review-reaction-yellow-fill" d="M42 24 L58 24 L50 42 Z" />
      <path className="review-reaction-orange-fill" d="M50 50 L59 67 L41 67 Z" />
      <path className="review-reaction-yellow-stroke" d="M50 42 L50 60" strokeWidth="2.6" />
      <circle className="review-reaction-orange-fill review-reaction-sand-dot" cx="45" cy="64" r="2" />
      <circle className="review-reaction-yellow-fill review-reaction-sand-dot" cx="55" cy="66" r="1.7" />
    </g>
  );
}

function HardFallingWeightReaction(): ReactElement {
  return (
    <g className="review-reaction-weight-mark">
      <path className="review-reaction-dark-stroke" d="M39 33 C39 22 61 22 61 33" strokeWidth="5" />
      <path className="review-reaction-slate-fill" d="M33 43 C33 28 67 28 67 43 L73 68 C74 76 66 81 50 81 C34 81 26 76 27 68 Z" />
      <path className="review-reaction-slate-stroke" d="M33 43 C33 28 67 28 67 43 L73 68 C74 76 66 81 50 81 C34 81 26 76 27 68 Z" strokeWidth="3" />
      <path className="review-reaction-yellow-stroke review-reaction-impact-lines" d="M24 83 L15 92 M38 87 L34 98 M62 87 L66 98 M76 83 L86 92" strokeWidth="3.5" />
    </g>
  );
}

function HardYellowCrackReaction(): ReactElement {
  return (
    <g className="review-reaction-crack-mark">
      <path className="review-reaction-yellow-shadow-stroke" d="M16 34 L29 45 L38 29 L49 55 L58 43 L69 75 L83 54" strokeWidth="8" />
      <path className="review-reaction-yellow-stroke" d="M16 34 L29 45 L38 29 L49 55 L58 43 L69 75 L83 54" strokeWidth="4" />
      <path className="review-reaction-yellow-stroke review-reaction-crack-branch" d="M38 29 L35 15 L27 8 M58 43 L64 23 L72 18 M69 75 L62 91 L55 96" strokeWidth="3" />
    </g>
  );
}

function HardRollingBoulderReaction(): ReactElement {
  return (
    <g className="review-reaction-boulder-mark">
      <circle className="review-reaction-stone-fill" cx="50" cy="61" r="15" />
      <circle className="review-reaction-stone-stroke" cx="50" cy="61" r="15" />
      <path className="review-reaction-dark-stroke" d="M42 55 L49 59 L46 68 M57 51 L61 60 L56 69 M39 64 L30 67" strokeWidth="2" />
      <circle className="review-reaction-dust-fill review-reaction-dust-one" cx="26" cy="76" r="4" />
      <circle className="review-reaction-dust-fill review-reaction-dust-two" cx="18" cy="72" r="3" />
      <circle className="review-reaction-dust-fill review-reaction-dust-three" cx="11" cy="78" r="2.5" />
    </g>
  );
}

function GoodHandDrawnCheckReaction(): ReactElement {
  return (
    <g className="review-reaction-check-mark">
      <path className="review-reaction-green-shadow-stroke" d="M21 51 L41 70 L82 27" strokeWidth="12" />
      <path className="review-reaction-green-stroke" d="M21 51 L41 70 L82 27" strokeWidth="7" />
      <path className="review-reaction-white-stroke" d="M21 51 L41 70 L82 27" strokeWidth="2" />
    </g>
  );
}

function GoodLightSweepReaction(): ReactElement {
  return (
    <g className="review-reaction-light-sweep-mark">
      <path className="review-reaction-yellow-stroke" d="M8 65 C29 18 58 76 92 31" strokeWidth="18" />
      <path className="review-reaction-green-stroke" d="M8 69 C31 31 58 70 92 38" strokeWidth="9" />
      <path className="review-reaction-white-stroke" d="M15 57 C38 32 62 58 86 32" strokeWidth="3" />
    </g>
  );
}

function GoodPaperPlaneCheckReaction(): ReactElement {
  return (
    <g className="review-reaction-plane-mark">
      <path className="review-reaction-plane-fill" d="M73 35 L22 23 L37 47 L27 73 Z" />
      <path className="review-reaction-green-stroke" d="M73 35 L22 23 L37 47 L27 73 Z" strokeWidth="2.6" />
      <path className="review-reaction-blue-stroke" d="M37 47 L73 35 L22 23" strokeWidth="2" />
      <path className="review-reaction-green-shadow-stroke" d="M48 69 L57 78 L78 55" strokeWidth="6" />
      <path className="review-reaction-green-stroke" d="M48 69 L57 78 L78 55" strokeWidth="3.5" />
    </g>
  );
}

function GoodCheckSealBounceReaction(): ReactElement {
  return (
    <g className="review-reaction-check-seal-mark">
      <polygon className="review-reaction-green-fill" points={makeScallopedSealPoints(50, 44, 16, 26, 0.09)} />
      <polygon className="review-reaction-white-stroke" points={makeScallopedSealPoints(50, 44, 16, 26, 0.09)} />
      <path className="review-reaction-white-stroke" d="M40 43 L48 51 L62 36" strokeWidth="5" />
    </g>
  );
}

function EasySparkleBurstReaction(): ReactElement {
  const sparklePoints: ReadonlyArray<Readonly<{ cx: number; cy: number; radius: number; rotation: number }>> = [
    { cx: 50, cy: 18, radius: 6, rotation: 0 },
    { cx: 73, cy: 29, radius: 5, rotation: 0.35 },
    { cx: 80, cy: 53, radius: 7, rotation: 0.2 },
    { cx: 63, cy: 72, radius: 5, rotation: 0.5 },
    { cx: 35, cy: 72, radius: 6, rotation: 0.1 },
    { cx: 20, cy: 51, radius: 5, rotation: 0.4 },
    { cx: 28, cy: 28, radius: 7, rotation: 0.2 },
  ];

  return (
    <g className="review-reaction-sparkle-burst-mark">
      {sparklePoints.map((sparkle, index) => (
        <polygon
          key={`${sparkle.cx}-${sparkle.cy}`}
          className={`review-reaction-sparkle-fill review-reaction-sparkle-${index}`}
          points={makeSparklePoints(sparkle.cx, sparkle.cy, sparkle.radius, sparkle.rotation)}
        />
      ))}
      <circle className="review-reaction-pink-fill" cx="45" cy="38" r="3" />
      <circle className="review-reaction-blue-fill" cx="59" cy="58" r="3.5" />
      <circle className="review-reaction-yellow-fill" cx="36" cy="54" r="2.5" />
    </g>
  );
}

function EasyRainbowStreakReaction(): ReactElement {
  return (
    <g className="review-reaction-rainbow-streak-mark">
      <path className="review-reaction-red-stroke" d="M6 42 C28 16 59 70 94 35" strokeWidth="4" />
      <path className="review-reaction-orange-stroke" d="M6 48 C30 22 58 75 94 41" strokeWidth="4" />
      <path className="review-reaction-yellow-stroke" d="M6 54 C31 29 57 78 94 47" strokeWidth="4" />
      <path className="review-reaction-green-stroke" d="M6 60 C31 36 56 82 94 53" strokeWidth="4" />
      <path className="review-reaction-blue-stroke" d="M6 66 C31 43 55 84 94 59" strokeWidth="4" />
      <path className="review-reaction-purple-stroke" d="M6 72 C31 50 54 86 94 65" strokeWidth="4" />
    </g>
  );
}

function EasyCrownBounceReaction(): ReactElement {
  return (
    <g className="review-reaction-crown-mark">
      <path className="review-reaction-yellow-fill" d="M27 62 L31 27 L43 47 L50 22 L57 47 L69 27 L73 62 Z" />
      <path className="review-reaction-orange-stroke" d="M27 62 L31 27 L43 47 L50 22 L57 47 L69 27 L73 62 Z" strokeWidth="3" />
      <rect className="review-reaction-orange-fill" x="25" y="58" width="50" height="11" rx="4" />
      <circle className="review-reaction-pink-fill" cx="31" cy="27" r="4" />
      <circle className="review-reaction-blue-fill" cx="50" cy="22" r="4" />
      <circle className="review-reaction-green-fill" cx="69" cy="27" r="4" />
      <polygon className="review-reaction-sparkle-fill" points={makeSparklePoints(78, 26, 5, 0.2)} />
    </g>
  );
}

function EasyUnicornFlybyReaction(): ReactElement {
  return (
    <g className="review-reaction-unicorn-mark">
      <path className="review-reaction-red-stroke" d="M16 51 C28 38 44 64 62 48" strokeWidth="2.8" />
      <path className="review-reaction-yellow-stroke" d="M15 56 C29 43 44 69 63 53" strokeWidth="2.8" />
      <path className="review-reaction-blue-stroke" d="M14 61 C29 48 44 74 64 58" strokeWidth="2.8" />
      <ellipse className="review-reaction-white-fill" cx="52" cy="48" rx="18" ry="9" />
      <ellipse className="review-reaction-white-fill" cx="67" cy="39" rx="8" ry="7" />
      <path className="review-reaction-purple-stroke" d="M36 47 C28 44 25 38 23 33" strokeWidth="3" />
      <path className="review-reaction-pink-stroke" d="M60 35 C55 39 56 47 51 52 M66 35 C62 40 63 45 59 50" strokeWidth="2.8" />
      <polygon className="review-reaction-yellow-fill" points="72,34 84,25 77,39" />
      <path className="review-reaction-white-stroke" d="M43 55 L41 68 M51 56 L51 69 M59 55 L62 68 M66 52 L70 64" strokeWidth="4" />
      <circle className="review-reaction-dark-fill" cx="70" cy="38" r="1.2" />
      <polygon className="review-reaction-sparkle-fill" points={makeSparklePoints(81, 54, 4, 0.1)} />
    </g>
  );
}

function renderReviewReactionVariant(variant: ReviewReactionVariant): ReactElement {
  switch (variant) {
    case "againRedScribbleSlash":
      return <AgainRedScribbleSlashReaction />;
    case "againRewindVortex":
      return <AgainRewindVortexReaction />;
    case "againStampFlyby":
      return <AgainStampFlybyReaction />;
    case "againWarningTape":
      return <AgainWarningTapeReaction />;
    case "hardHourglassSand":
      return <HardHourglassSandReaction />;
    case "hardFallingWeight":
      return <HardFallingWeightReaction />;
    case "hardYellowCrack":
      return <HardYellowCrackReaction />;
    case "hardRollingBoulder":
      return <HardRollingBoulderReaction />;
    case "goodHandDrawnCheck":
      return <GoodHandDrawnCheckReaction />;
    case "goodLightSweep":
      return <GoodLightSweepReaction />;
    case "goodPaperPlaneCheck":
      return <GoodPaperPlaneCheckReaction />;
    case "goodCheckSealBounce":
      return <GoodCheckSealBounceReaction />;
    case "easySparkleBurst":
      return <EasySparkleBurstReaction />;
    case "easyRainbowStreak":
      return <EasyRainbowStreakReaction />;
    case "easyCrownBounce":
      return <EasyCrownBounceReaction />;
    case "easyUnicornFlyby":
      return <EasyUnicornFlybyReaction />;
  }
}

export function ReviewRatingReactionLayer(props: ReviewRatingReactionLayerProps): ReactElement {
  const { events } = props;

  return (
    <div className="review-rating-reaction-layer" aria-hidden="true" data-testid="review-rating-reaction-layer">
      {events.map((event) => (
        <div
          key={event.id}
          className={`review-rating-reaction-event review-rating-reaction-${event.variant}`}
          data-review-reaction-rating={event.rating}
          data-review-reaction-variant={event.variant}
          data-testid="review-rating-reaction-event"
          style={makeReviewReactionStyle(event)}
        >
          <svg className="review-rating-reaction-art" viewBox="0 0 100 100" focusable="false">
            {renderReviewReactionVariant(event.variant)}
          </svg>
        </div>
      ))}
    </div>
  );
}
