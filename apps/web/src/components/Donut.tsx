import { formatCompactINR } from '@/lib/format';

export interface DonutSegment {
  key: string;
  label: string;
  amount: number;
  /** A literal colour: SVG strokes cannot take a Tailwind class. */
  colour: string;
  count?: number;
}

const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A proportional ring with a legend.
 *
 * Hand-rolled rather than pulled from a chart library: this is one ring drawn
 * from five numbers, and the smallest charting dependency would outweigh the
 * whole page it sits on.
 */
export function Donut({
  segments,
  caption,
  emptyLabel = 'Nothing outstanding',
}: {
  segments: DonutSegment[];
  caption: string;
  emptyLabel?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.amount, 0);

  if (total <= 0) {
    return <p className="px-5 py-8 text-center text-sm text-ink-500">{emptyLabel}</p>;
  }

  let consumed = 0;

  return (
    <div className="px-5 pb-5">
      <div className="flex justify-center">
        <svg
          viewBox="0 0 200 200"
          className="h-44 w-44"
          role="img"
          aria-label={`${caption}: ${segments
            .filter((segment) => segment.amount > 0)
            .map(
              (segment) =>
                `${segment.label} ${formatCompactINR(segment.amount)}, ${Math.round(
                  (segment.amount / total) * 100,
                )}%`,
            )
            .join('; ')}`}
        >
          <g transform="rotate(-90 100 100)">
            {segments.map((segment) => {
              const fraction = segment.amount / total;
              const dash = fraction * CIRCUMFERENCE;
              const offset = -consumed * CIRCUMFERENCE;
              consumed += fraction;

              if (segment.amount <= 0) return null;
              return (
                <circle
                  key={segment.key}
                  cx={100}
                  cy={100}
                  r={RADIUS}
                  fill="none"
                  stroke={segment.colour}
                  strokeWidth={24}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
                  strokeDashoffset={offset}
                />
              );
            })}
          </g>
          <text
            x={100}
            y={96}
            textAnchor="middle"
            className="fill-ink-900 text-[20px] font-semibold"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCompactINR(total)}
          </text>
          <text x={100} y={116} textAnchor="middle" className="fill-ink-500 text-[11px]">
            {caption}
          </text>
        </svg>
      </div>

      <ul className="mt-4 space-y-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: segment.colour }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-ink-600">{segment.label}</span>
            {segment.count !== undefined ? (
              <span className="text-xs text-ink-400">{segment.count}</span>
            ) : null}
            <span className="tabular font-medium text-ink-900">
              {formatCompactINR(segment.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
