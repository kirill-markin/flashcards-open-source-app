import { useId, type ReactElement } from "react";
import type { ReviewRating } from "../../../../../backend/src/scheduling";

type ReviewCircleFillIconProps = Readonly<{
  className: string;
  children: ReactElement;
}>;

type ReviewRatingIconProps = Readonly<{
  rating: ReviewRating;
}>;

// The black glyph is masked out of the filled circle, so the button fill shows through in every button state.
function ReviewCircleFillIcon(props: ReviewCircleFillIconProps): ReactElement {
  const { className, children } = props;
  const maskId = useId();

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        {children}
      </mask>
      <circle cx="12" cy="12" r="10" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}

export function ReviewEyeIcon(): ReactElement {
  return (
    <svg className="review-btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2.5 12C4.6 7.9 8 5.5 12 5.5S19.4 7.9 21.5 12C19.4 16.1 16 18.5 12 18.5S4.6 16.1 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ReviewTagIcon(): ReactElement {
  return (
    <svg className="review-tag-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.5 4.9V11.4C3.5 11.8 3.66 12.2 3.94 12.5L11.5 20.06C12.09 20.65 13.04 20.65 13.62 20.06L20.06 13.62C20.65 13.04 20.65 12.09 20.06 11.5L12.5 3.94C12.2 3.66 11.8 3.5 11.4 3.5H4.9C4.13 3.5 3.5 4.13 3.5 4.9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ReviewAgainIcon(): ReactElement {
  return (
    <ReviewCircleFillIcon className="review-btn-icon review-btn-icon-again">
      <path
        d="M9.5 7 6.5 10l3 3M6.5 10h7a3.5 3.5 0 0 1 0 7H11"
        fill="none"
        stroke="black"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ReviewCircleFillIcon>
  );
}

function ReviewHardIcon(): ReactElement {
  return (
    <ReviewCircleFillIcon className="review-btn-icon">
      <>
        <path d="M6.5 14.5a4.75 4.5 0 0 1 9.5 0Z" fill="black" />
        <circle cx="17.6" cy="12.6" r="1.5" fill="black" />
        <path
          d="M5.5 14.5h12M8.5 15.5v1.6M14 15.5v1.6"
          fill="none"
          stroke="black"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </>
    </ReviewCircleFillIcon>
  );
}

function ReviewGoodIcon(): ReactElement {
  return (
    <ReviewCircleFillIcon className="review-btn-icon">
      <path
        d="M7.5 12.5 10.5 15.5 16.5 9"
        fill="none"
        stroke="black"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ReviewCircleFillIcon>
  );
}

function ReviewEasyIcon(): ReactElement {
  return (
    <svg className="review-btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M10 3C10.7 7.9 12.1 9.3 17 10 12.1 10.7 10.7 12.1 10 17 9.3 12.1 7.9 10.7 3 10 7.9 9.3 9.3 7.9 10 3Z" />
      <path d="M18 2.5C18.3 4.6 18.9 5.2 21 5.5 18.9 5.8 18.3 6.4 18 8.5 17.7 6.4 17.1 5.8 15 5.5 17.1 5.2 17.7 4.6 18 2.5Z" />
      <path d="M18 14.5C18.35 16.95 19.05 17.65 21.5 18 19.05 18.35 18.35 19.05 18 21.5 17.65 19.05 16.95 18.35 14.5 18 16.95 17.65 17.65 16.95 18 14.5Z" />
    </svg>
  );
}

const reviewRatingIcons: Readonly<Record<ReviewRating, () => ReactElement>> = {
  0: ReviewAgainIcon,
  1: ReviewHardIcon,
  2: ReviewGoodIcon,
  3: ReviewEasyIcon,
};

export function ReviewRatingIcon(props: ReviewRatingIconProps): ReactElement {
  const Icon = reviewRatingIcons[props.rating];
  return <Icon />;
}
