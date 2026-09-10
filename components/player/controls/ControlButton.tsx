"use client";
import type { ReactNode, Ref } from "react";
const paths = {
  play: "M8 5l12 7-12 7V5Z",
  pause: "M8 5v14M16 5v14",
  back: "M15 5l-7 7 7 7",
  next: "m5 5 11 7-11 7V5Zm14 0v14",
  rewind: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
  forward: "M20 10a8 8 0 1 0-1 8m1-14v6h-6",
  volume: "M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  muted: "M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6",
  settings: "M4 7h16M4 17h16M9 4v6m6 4v6",
  pip: "M3 4h18v16H3V4Zm9 8h7v6h-7v-6",
  fullscreen: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  close: "m6 6 12 12M6 18 18 6",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function ControlButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
  children,
  buttonRef,
}: {
  label: string;
  icon: keyof typeof paths;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="zivora-control"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
