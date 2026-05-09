import { useEffect, useState } from 'react';

interface ActionHighlightProps {
  selector: string | null;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;

export function ActionHighlight({ selector }: ActionHighlightProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    let cancelled = false;
    let frame = 0;

    function update() {
      if (cancelled) return;
      let el: Element | null = null;
      try {
        el = document.querySelector(selector!);
      } catch {
        el = null;
      }
      if (!el) {
        setRect(null);
      } else {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          setRect(null);
        } else {
          setRect({
            top: r.top - PADDING,
            left: r.left - PADDING,
            width: r.width + PADDING * 2,
            height: r.height + PADDING * 2,
          });
        }
      }
      frame = requestAnimationFrame(update);
    }

    frame = requestAnimationFrame(update);

    const onScrollOrResize = () => {
      // RAF loop already picks up new rect; this just nudges it immediately.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [selector]);

  if (!selector || !rect) return null;

  return (
    <div
      data-flowmind-highlight={selector}
      className="pointer-events-none fixed z-[2147483646] animate-pulse rounded-md ring-2 ring-blue-400 ring-offset-2 ring-offset-transparent shadow-[0_0_20px_4px_rgba(96,165,250,0.65)] transition-all duration-150"
      style={{
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    />
  );
}
