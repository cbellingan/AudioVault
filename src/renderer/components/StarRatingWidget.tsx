import React, { useState } from 'react';

export interface StarRatingWidgetProps {
  rating: number; // 0 to 5
  onChange?: (rating: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  readOnly?: boolean;
  className?: string;
  testIdPrefix?: string;
}

export function StarRatingWidget({
  rating,
  onChange,
  size = 'md',
  showLabel = false,
  readOnly = false,
  className = '',
  testIdPrefix = 'star-rating',
}: StarRatingWidgetProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const displayRating = hoverRating !== null ? hoverRating : (rating || 0);

  const handleStarClick = (starValue: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly || !onChange) return;
    // Clicking the current rating resets/clears it to 0
    if (rating === starValue) {
      onChange(0);
    } else {
      onChange(starValue);
    }
  };

  const getStarTooltip = (starValue: number) => {
    if (rating === starValue) {
      return `Rated ${starValue} star${starValue === 1 ? '' : 's'} (click to clear)`;
    }
    return `Rate ${starValue} star${starValue === 1 ? '' : 's'}`;
  };

  const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Master / Top'];

  return (
    <div
      className={`star-rating-container size-${size} ${className} ${readOnly ? 'read-only' : ''}`}
      onMouseLeave={() => setHoverRating(null)}
      data-testid={`${testIdPrefix}-container`}
      title={readOnly ? (rating ? `${rating} Stars` : 'Unrated') : undefined}
    >
      <div className="stars-row" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= displayRating;
          return (
            <button
              key={star}
              type="button"
              className={`star-btn ${isFilled ? 'filled' : 'empty'} ${hoverRating !== null && star <= hoverRating ? 'hovered' : ''}`}
              data-testid={`${testIdPrefix}-star-${star}`}
              aria-label={`${star} star${star === 1 ? '' : 's'}`}
              aria-checked={rating === star}
              role={readOnly ? undefined : 'radio'}
              disabled={readOnly}
              onMouseEnter={() => !readOnly && setHoverRating(star)}
              onClick={(e) => handleStarClick(star, e)}
              title={readOnly ? undefined : getStarTooltip(star)}
            >
              ★
            </button>
          );
        })}
      </div>
      {showLabel && (
        <span className="rating-label">
          {displayRating > 0 ? `${displayRating}/5 · ${labels[displayRating]}` : 'Unrated'}
        </span>
      )}
    </div>
  );
}
