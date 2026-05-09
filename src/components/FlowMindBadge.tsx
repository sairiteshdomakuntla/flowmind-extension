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
      title="Open FlowMind (Ctrl/Cmd+Shift+K)"
      aria-label="Open FlowMind"
      className="fixed bottom-5 right-5 z-[2147483646] flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200"
      style={{
        background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
        boxShadow: '0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(124,58,237,0.5), 0 0 0 0 rgba(124,58,237,0.3)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'scale(1.1)';
        el.style.boxShadow = '0 0 0 1px rgba(139,92,246,0.6), 0 4px 30px rgba(124,58,237,0.7), 0 0 20px rgba(124,58,237,0.4)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = 'scale(1)';
        el.style.boxShadow = '0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(124,58,237,0.5), 0 0 0 0 rgba(124,58,237,0.3)';
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
      }}
    >
      {/* Icon: abstract flow/mind symbol */}
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" stroke="white" strokeWidth="1.6">
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18" strokeLinecap="round" />
        <path d="M4.22 4.22l1.77 1.77M14.01 14.01l1.77 1.77M4.22 15.78l1.77-1.77M14.01 5.99l1.77-1.77" strokeLinecap="round" />
      </svg>
    </button>
  );
}
