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

export function IconSignal({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 20v-3M10 20v-7M15 20V9M20 20V5" />
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

export function IconHash({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 9h14M4 15h14M10 3L8 21M16 3l-2 18" />
    </Icon>
  );
}
