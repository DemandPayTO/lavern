/**
 * StarlingMark — The Starling three-dot mark.
 *
 * Three orange dots in the upper-left corner of every page.
 * Clicking navigates home (Starling dashboard).
 */

import { useState, useEffect } from 'react';
import { colors, fonts } from '../staffing/styles/tokens.js';

interface StarlingMarkProps {
  /** Font size of the W in pixels. Default 28. */
  size?: number;
  /** Navigate on click. Default: go to landing. */
  onClick?: () => void;
  /** Set to true on views with their own cursor (landing page). */
  hideCursor?: boolean;
}

export function StarlingMark({ size = 28, onClick, hideCursor }: StarlingMarkProps) {
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      window.location.hash = '#/';
    }
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        top: 24,
        left: 28,
        zIndex: 10000,
        background: 'none',
        border: 'none',
        padding: 0,
        margin: 0,
        cursor: hideCursor ? 'none' : 'pointer',
        fontFamily: fonts.serif,
        fontSize: size,
        fontWeight: 300,
        color: colors.text,
        letterSpacing: 1,
        lineHeight: 1,
        opacity: mounted ? (hovered ? 1 : 0.5) : 0,
        transition: 'opacity 0.3s ease',
        userSelect: 'none' as const,
      }}
      aria-label="Starling — Home"
    >
      <span style={{ display: 'flex', gap: 3 }} aria-hidden="true">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ea580c', display: 'block' }} />
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
      </span>
    </button>
  );
}
