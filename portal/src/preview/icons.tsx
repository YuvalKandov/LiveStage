import type { ReactNode } from "react";

// Approximate glyphs for the SF Symbol allowlist (build spec §4.5). These are not the real SF
// Symbols - the iOS simulator is the authoritative renderer - but they keep the icon mapping faithful
// (the right glyph for the identifier, tinted with the accent via currentColor).

const GLYPHS: Record<string, ReactNode> = {
  airplane: <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill="currentColor" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  shippingbox: (
    <>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 7l9 4 9-4M12 11v10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  mappin: <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" fill="currentColor" />,
  bag: (
    <>
      <path d="M6 8h12l-1 12H7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 8a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  car: (
    <>
      <path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v5h-3v-2H6v2H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="7.5" cy="16.5" r="1.3" fill="currentColor" />
      <circle cx="16.5" cy="16.5" r="1.3" fill="currentColor" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

export function Icon(props: { name: string; color: string; size?: number }) {
  const size = props.size ?? 14;
  const glyph = GLYPHS[props.name] ?? GLYPHS.bell;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ color: props.color, display: "block" }}>
      {glyph}
    </svg>
  );
}
