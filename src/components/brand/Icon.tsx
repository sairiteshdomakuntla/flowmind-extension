import type { SVGProps } from 'react';

// Single stroke-icon module. 1.5px strokes, rounded joins, 20px viewport.
// Keep this set small — every icon used in FlowMind chrome lives here so
// the visual language stays consistent.

type Props = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, strokeWidth = 1.5, ...rest }: Props) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export function IconPlay(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 4.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

export function IconPause(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M7.5 4.5v11M12.5 4.5v11" />
    </svg>
  );
}

export function IconStop(p: Props) {
  return (
    <svg {...base(p)}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export function IconCheck(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export function IconAlert(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.5v4.5" />
      <circle cx="10" cy="13.75" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  );
}

export function IconArrow(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export function IconDot(p: Props) {
  return (
    <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor">
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}

export function IconClock(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.5l3 1.5" />
    </svg>
  );
}

export function IconSpark(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M10 3.5l1.6 4 4 1.6-4 1.6L10 14.7l-1.6-4-4-1.6 4-1.6L10 3.5z" />
    </svg>
  );
}

export function IconCommand(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M7.5 5a2 2 0 11-2 2h9a2 2 0 11-2-2v9a2 2 0 11-2 2v-9a2 2 0 11-2 2" />
    </svg>
  );
}

export function IconRetry(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 10a5.5 5.5 0 109.5-3.8M14.5 4v3.5h-3.5" />
    </svg>
  );
}

// Action-glyph icons used inline next to step rows. One per ActionType.
export function IconAction({ kind, ...p }: Props & { kind: string }) {
  switch (kind) {
    case 'click':
    case 'click_result':
      return (
        <svg {...base(p)}>
          <path d="M9 4v3M5.5 7l2 2M4 11h3M14.5 7l-2 2M9 13l1 5 2-3.5 4-1-7-2.5z" />
        </svg>
      );
    case 'type':
      return (
        <svg {...base(p)}>
          <rect x="3.5" y="6" width="13" height="8" rx="1.5" />
          <path d="M6.5 10h7" />
        </svg>
      );
    case 'press_key':
      return (
        <svg {...base(p)}>
          <rect x="3.5" y="6" width="13" height="8" rx="1.5" />
          <path d="M6.5 10h7M9 8.5v3" />
        </svg>
      );
    case 'scroll':
      return (
        <svg {...base(p)}>
          <rect x="7" y="3" width="6" height="14" rx="3" />
          <path d="M10 6v4" />
        </svg>
      );
    case 'navigate':
      return (
        <svg {...base(p)}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 3v14M3 10h14" />
        </svg>
      );
    case 'extract':
      return (
        <svg {...base(p)}>
          <path d="M5 4.5h7l3 3v8a1.5 1.5 0 01-1.5 1.5h-8.5A1.5 1.5 0 013.5 15.5V6A1.5 1.5 0 015 4.5z" />
          <path d="M12 4.5v3h3M6 11h8M6 13.5h5" />
        </svg>
      );
    case 'wait':
      return <IconClock {...p} />;
    case 'open_tab':
    case 'switch_tab':
      return (
        <svg {...base(p)}>
          <rect x="3" y="6" width="14" height="10" rx="1.5" />
          <path d="M3 9h14M7 4.5h6" />
        </svg>
      );
    case 'finish':
      return <IconCheck {...p} />;
    default:
      return <IconDot {...p} />;
  }
}
