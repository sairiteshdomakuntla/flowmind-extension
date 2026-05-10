import { FlowMark } from './brand/FlowMark';

interface FlowMindBadgeProps {
  onClick: () => void;
  hidden?: boolean;
}

export function FlowMindBadge({ onClick, hidden }: FlowMindBadgeProps) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title="FlowMind  ·  ⌘⇧K"
      aria-label="Open FlowMind"
      className="group fixed bottom-5 right-5 z-[2147483646] flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200"
      style={{
        background:
          'linear-gradient(180deg, rgba(15,15,26,0.92) 0%, rgba(8,8,15,0.92) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow:
          '0 8px 24px -8px rgba(0,0,0,0.6), 0 1px 0 0 rgba(255,255,255,0.06) inset',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(124,92,255,0.45)';
        el.style.boxShadow =
          '0 8px 24px -6px rgba(124,92,255,0.35), 0 1px 0 0 rgba(255,255,255,0.06) inset';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'rgba(255,255,255,0.08)';
        el.style.boxShadow =
          '0 8px 24px -8px rgba(0,0,0,0.6), 0 1px 0 0 rgba(255,255,255,0.06) inset';
      }}
    >
      <FlowMark size={18} />
    </button>
  );
}
