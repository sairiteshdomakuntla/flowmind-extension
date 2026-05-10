import type { SVGProps } from 'react';

// FlowMark — the FlowMind brand mark.
//
// A single continuous arc that opens into an aperture: the operating layer
// "watching" the page. Drawn in the aurora gradient, no robot/face shapes,
// no neon outline — just a clean stroke and a soft accent dot.

interface FlowMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
  monochrome?: boolean;
}

export function FlowMark({ size = 20, monochrome = false, ...rest }: FlowMarkProps) {
  const id = 'fm-mark-grad';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...rest}
    >
      {!monochrome && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7C5CFF" />
            <stop offset="1" stopColor="#4FA3FF" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M4 16c0-6.6 3.6-10 8-10 3.6 0 6 2 6 5.5 0 3.2-2.2 5-5 5-2.2 0-3.6-1.2-3.6-3 0-1.6 1.1-2.7 2.8-2.7"
        stroke={monochrome ? 'currentColor' : `url(#${id})`}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="12.2"
        cy="11.2"
        r="1.4"
        fill={monochrome ? 'currentColor' : `url(#${id})`}
      />
    </svg>
  );
}
