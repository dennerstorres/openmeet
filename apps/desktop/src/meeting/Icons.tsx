import type { ReactNode } from "react";

// Inline stroke icons. Decorative: the button around each one carries the label.

function Icon({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconMic({ off = false, size }: { off?: boolean; size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </Icon>
  );
}

export function IconHeadphones({ off = false, size }: { off?: boolean; size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
      {off ? <path d="M3 3l18 18" /> : null}
    </Icon>
  );
}

export function IconCamera({ off = false, size }: { off?: boolean; size?: number }) {
  return (
    <Icon size={size}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
      {off ? <path d="M3 3l18 18" /> : null}
    </Icon>
  );
}

export function IconScreen({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Icon>
  );
}

export function IconHangUp({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 15c5-5 11-5 16 0l-2 3-3-1v-2.5c-2-.7-4-.7-6 0V17l-3 1z" />
    </Icon>
  );
}

export function IconSpeaker({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </Icon>
  );
}

export function IconClock({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function IconPlus({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconSignal({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 20v-3M10 20v-7M15 20V9M20 20V5" />
    </Icon>
  );
}

export function IconGear({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Icon>
  );
}

export function IconUserPlus({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
    </Icon>
  );
}

export function IconExpand({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
    </Icon>
  );
}

export function IconLogo({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </Icon>
  );
}
