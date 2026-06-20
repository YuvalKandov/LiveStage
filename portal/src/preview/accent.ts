import type { AccentStyle } from "../types";

// The exact accent->color map the renderer uses (LiveStageUI/AccentStyle+Color.swift). Mirrored here
// so the preview tints match the device, not just "look like iOS".
export const ACCENT_HEX: Record<AccentStyle, string> = {
  blue: "#0a84ff",
  orange: "#ff9f0a",
  green: "#30d158",
  indigo: "#5e5ce6",
  teal: "#64d2ff",
};

/** renderTint: the completed look mutes the accent to 50% (LiveStageUI Primitives.renderTint). */
export function tint(accent: AccentStyle, completed: boolean): string {
  return completed ? `${ACCENT_HEX[accent]}80` : ACCENT_HEX[accent];
}
