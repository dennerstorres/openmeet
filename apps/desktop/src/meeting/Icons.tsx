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
      <path d="M4 7h3m4 0h9M4 17h9m4 0h3" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
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

export function IconUsers({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M16 4.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 6" />
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

// Same symbol as brand/symbol.svg.
export function IconLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth={10} />
      <circle cx="50" cy="50" r="10" fill="currentColor" />
      <circle cx="76" cy="24" r="8" fill="currentColor" />
    </svg>
  );
}
