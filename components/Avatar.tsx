'use client';
import type { CSSProperties } from 'react';
import { Avatar as AstryxAvatar, AvatarStatusDot, type AvatarSize } from '@astryxdesign/core/Avatar';
import { avColor } from '@/lib/utils';

interface Props {
  name: string;
  size?: number;
  /** Photo URL or data URL. Falls back to initials when empty or on load error. */
  src?: string;
  /** Presence: true shows a green dot; omit/false for no indicator. */
  online?: boolean;
}

export default function Avatar({ name, size = 22, src, online }: Props) {
  const bg = name ? avColor(name) : 'var(--cauliflower-dark)';
  return (
    // Self-scoped theme so avatars work anywhere (gradient header, portals,
    // non-astryx views) without an ancestor [data-astryx-theme] container.
    <span data-astryx-theme="neutral" style={{ display: 'inline-flex', flexShrink: 0, verticalAlign: 'middle' }}>
      <AstryxAvatar
        name={name || undefined}
        src={src || undefined}
        size={size as AvatarSize}
        status={online ? <AvatarStatusDot variant="success" aria-label="Online" /> : undefined}
        style={
          {
            // astryx draws the initials fallback and presence dot from these
            // theme vars; overriding them per instance keeps the per-name
            // colours and the brand-green dot.
            '--color-neutral': bg,
            '--color-text-secondary': '#fff',
            '--color-success': 'var(--pea)',
          } as CSSProperties
        }
      />
    </span>
  );
}
