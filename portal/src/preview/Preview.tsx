import { useEffect, useState, type ReactNode } from "react";
import type {
  AccentStyle,
  AdminSessionAttributes,
  CountdownPayload,
  JourneyPayload,
  ProgressPayload,
  TemplateLabels,
  TemplatePayload,
  TemplateType,
} from "../types";
import { ACCENT_HEX, tint } from "./accent";
import { Icon } from "./icons";

// Four-surface preview mirroring LiveStageUI (JourneyViews / CountdownViews / ProgressViews +
// Primitives). This is an APPROXIMATION for configuration only - the iOS simulator is the
// authoritative renderer (the note is shown on the preview). Fidelity, not polish, is the goal:
//  - same accent->color map and completed mute (preview/accent.ts).
//  - same per-surface field visibility + truncation: Lock Screen title 2 lines and sub/step/stage
//    1 line; Expanded title 1 line; Compact shows value + icon only (never the title); Minimal shows
//    a ring+icon (Journey/Progress) or icon only (Countdown).
//  - same deterministic priority chains (Journey trailing countdown->%->status->iconOnly; Countdown
//    is the hero value everywhere; Progress % everywhere).
//  - same terminal look: Countdown (target reached) and Progress (>=1) mute the accent + show a
//    check, and Countdown shows the zeroStateLabel on Lock/Expanded but 0:00 on Compact; Journey has
//    NO terminal styling, exactly as the renderer.

export interface PreviewDraft {
  type: TemplateType;
  icon: string;
  accent: AccentStyle;
  labels: TemplateLabels;
}

const SAMPLE_COUNTDOWN = "1:42:00"; // a static stand-in for the device's self-ticking timer

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function Preview(props: { draft: PreviewDraft }) {
  const [terminal, setTerminal] = useState(false);
  const surfaces = buildSurfaces(props.draft, terminal);

  return (
    <div className="pv">
      <div className="pv-bar">
        <h6 className="pv-title">Four-surface preview</h6>
        <label className="pv-toggle">
          <input type="checkbox" checked={terminal} onChange={(e) => setTerminal(e.target.checked)} /> Show
          completed / terminal state
        </label>
      </div>
      <div className="pv-note">
        Approximate preview for configuration only. The iOS simulator is the authoritative renderer.
      </div>
      <div className="pv-surfaces">
        <Surface label="Lock Screen">{surfaces.lock}</Surface>
        <Surface label="Dynamic Island - compact">
          <div className="pv-island-row">{surfaces.compact}</div>
        </Surface>
        <Surface label="Dynamic Island - expanded">
          <div className="pv-island-row">{surfaces.expanded}</div>
        </Surface>
        <Surface label="Dynamic Island - minimal">
          <div className="pv-island-row">{surfaces.minimal}</div>
        </Surface>
      </div>
    </div>
  );
}

function Surface(props: { label: string; children: ReactNode }) {
  return (
    <div className="pv-surface">
      <div className="pv-surface-label">{props.label}</div>
      {props.children}
    </div>
  );
}

// --- shared chrome ------------------------------------------------------------------------------

function Bar(props: { value: number; color: string }) {
  return (
    <div className="pv-track">
      <div className="pv-fill" style={{ width: `${Math.max(0, Math.min(1, props.value)) * 100}%`, background: props.color }} />
    </div>
  );
}

function Ring(props: { value: number; color: string; name: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, props.value)) * c;
  return (
    <div className="pv-ring">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
        <circle
          cx="12" cy="12" r={r} fill="none" stroke={props.color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`} transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="pv-ring-icon"><Icon name={props.name} color={props.color} size={11} /></span>
    </div>
  );
}

function Pill(props: { children: ReactNode }) {
  return <div className="pv-pill">{props.children}</div>;
}

function MiniDot(props: { children: ReactNode }) {
  return <div className="pv-mini">{props.children}</div>;
}

function IconCircle(props: { name: string; color: string }) {
  return (
    <span className="pv-icon-circle">
      <Icon name={props.name} color={props.color} size={15} />
    </span>
  );
}

function Expanded(props: { leading: ReactNode; center?: ReactNode; trailing?: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="pv-exp">
      <div className="pv-exp-top">
        <div className="pv-exp-lead">{props.leading}</div>
        {props.trailing && <div className="pv-exp-trail">{props.trailing}</div>}
      </div>
      {props.center && <div className="pv-exp-center">{props.center}</div>}
      {props.bottom && <div className="pv-exp-bottom">{props.bottom}</div>}
    </div>
  );
}

function Check(props: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" style={{ color: props.color }}>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M7 12.5l3 3 7-7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// --- per-template builders ----------------------------------------------------------------------

interface Surfaces {
  lock: ReactNode;
  compact: ReactNode;
  expanded: ReactNode;
  minimal: ReactNode;
}

function buildSurfaces(d: PreviewDraft, terminal: boolean): Surfaces {
  switch (d.type) {
    case "countdown":
      return countdownSurfaces(d, terminal);
    case "progress":
      return progressSurfaces(d, terminal);
    default:
      return journeySurfaces(d, terminal);
  }
}

// Journey (design §04). No terminal styling in the renderer, so the preview adds none either.
function journeySurfaces(d: PreviewDraft, terminal: boolean): Surfaces {
  const accent = ACCENT_HEX[d.accent];
  const hasTarget = !terminal; // terminal sample drops targetDate so trailing falls to the percent
  const progress = terminal ? 1 : 0.35;
  const currentStep = terminal ? "Arrived" : "Heading to the airport";
  const status = terminal ? "Arrived" : "On time";
  const nextStep = "Flight AZ809";
  const trailingValue = hasTarget ? SAMPLE_COUNTDOWN : pct(progress);

  const lock = (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={d.icon} color={accent} />
        <span className="pv-accent" style={{ color: accent }}>{status}</span>
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">Trip to Rome</div>
      <div className="pv-sub pv-clamp1">{currentStep}</div>
      <Bar value={progress} color={accent} />
      <div className="pv-foot">
        <span className="pv-muted pv-clamp1">{labelValue(d.labels.nextStepLabel, nextStep)}</span>
        <span className="pv-spacer" />
        {hasTarget && (
          <span className="pv-foot-right">
            {d.labels.targetLabel && <span className="pv-muted">{d.labels.targetLabel}</span>}
            <span className="pv-strong">{SAMPLE_COUNTDOWN}</span>
          </span>
        )}
      </div>
    </div>
  );

  const compact = (
    <Pill>
      <Icon name={d.icon} color={accent} />
      <span className="pv-pill-val">{trailingValue}</span>
    </Pill>
  );

  const expanded = (
    <Expanded
      leading={
        <>
          <IconCircle name={d.icon} color={accent} />
          <span className="pv-exp-text">
            <span className="pv-exp-title pv-clamp1">Trip to Rome</span>
            <span className="pv-exp-sub pv-clamp1">{currentStep}</span>
          </span>
        </>
      }
      center={<span className="pv-muted">{status}</span>}
      trailing={<span className="pv-strong" style={{ color: accent }}>{trailingValue}</span>}
      bottom={
        <div className="pv-exp-bottomrow">
          <span className="pv-muted pv-clamp1">{labelValue(d.labels.nextStepLabel, nextStep)}</span>
          <Bar value={progress} color={accent} />
        </div>
      }
    />
  );

  const minimal = <MiniDot><Ring value={progress} color={accent} name={d.icon} /></MiniDot>;

  return { lock, compact, expanded, minimal };
}

// Countdown (design §05). Terminal = target reached: muted accent + check; zeroStateLabel on
// Lock/Expanded, but 0:00 on Compact.
function countdownSurfaces(d: PreviewDraft, terminal: boolean): Surfaces {
  const accent = tint(d.accent, terminal);
  const zero = d.labels.zeroStateLabel && d.labels.zeroStateLabel.trim() ? d.labels.zeroStateLabel : "0:00";
  const cd = terminal ? zero : SAMPLE_COUNTDOWN;
  const status = "On time";
  const subtitleLine = ["Gate B12", "Terminal 3"].join(" · ");

  const lock = (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={d.icon} color={accent} />
        {terminal && <Check color={accent} />}
        <span className="pv-accent" style={{ color: accent }}>{status}</span>
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">Flight to Rome</div>
      <div className="pv-sub pv-clamp1">{subtitleLine}</div>
      <div className="pv-foot">
        {d.labels.countdownLabel && <span className="pv-muted">{d.labels.countdownLabel}</span>}
        <span className="pv-spacer" />
        <span className="pv-strong pv-big" style={{ color: accent }}>{cd}</span>
      </div>
    </div>
  );

  const compact = (
    <Pill>
      <Icon name={d.icon} color={accent} />
      <span className="pv-pill-val">{terminal ? "0:00" : SAMPLE_COUNTDOWN}</span>
    </Pill>
  );

  const expanded = (
    <Expanded
      leading={
        <>
          <IconCircle name={d.icon} color={accent} />
          <span className="pv-exp-text">
            <span className="pv-exp-title pv-clamp1">
              Flight to Rome {terminal && <Check color={accent} />}
            </span>
            <span className="pv-exp-sub pv-clamp1">Gate B12</span>
          </span>
        </>
      }
      center={<span className="pv-muted">{status}</span>}
      trailing={<span className="pv-strong" style={{ color: accent }}>{cd}</span>}
      bottom={
        <span className="pv-muted pv-clamp1 pv-pin">
          <Icon name="mappin" color="#8e8e93" size={11} /> Terminal 3
        </span>
      }
    />
  );

  // Countdown minimal is icon-only (locked: a 2-char countdown is ambiguous).
  const minimal = <MiniDot><Icon name={d.icon} color={accent} size={15} /></MiniDot>;

  return { lock, compact, expanded, minimal };
}

// Progress (design §06). Terminal = progress >= 1: muted accent + check, bar full, 100%.
function progressSurfaces(d: PreviewDraft, terminal: boolean): Surfaces {
  const accent = tint(d.accent, terminal);
  const progress = terminal ? 1 : 0.8;
  const detail = "2 items left";
  const stage = "Packing";
  // completionTime joins the label and time with a space ("Done 14:30"), not the nextStep "·".
  const cl = d.labels.completionLabel;
  const completion = cl && cl.trim() ? `${cl} 14:30` : "14:30";

  const lock = (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={d.icon} color={accent} />
        {terminal && <Check color={accent} />}
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">Preparing your order</div>
      <div className="pv-sub pv-clamp1">{stage}</div>
      <Bar value={progress} color={accent} />
      <div className="pv-foot">
        <span className="pv-muted pv-clamp1">{detail}</span>
        <span className="pv-spacer" />
        <span className="pv-strong pv-muted">{completion}</span>
      </div>
    </div>
  );

  const compact = (
    <Pill>
      <Icon name={d.icon} color={accent} />
      <span className="pv-pill-val">{pct(progress)}</span>
    </Pill>
  );

  const expanded = (
    <Expanded
      leading={
        <>
          <IconCircle name={d.icon} color={accent} />
          <span className="pv-exp-text">
            <span className="pv-exp-title pv-clamp1">
              Preparing your order {terminal && <Check color={accent} />}
            </span>
            <span className="pv-exp-sub pv-clamp1">{stage}</span>
          </span>
        </>
      }
      center={<span className="pv-muted">{completion}</span>}
      trailing={<span className="pv-strong" style={{ color: accent }}>{pct(progress)}</span>}
      bottom={
        <div className="pv-exp-bottomrow">
          <Bar value={progress} color={accent} />
          <span className="pv-muted pv-clamp1">{detail}</span>
        </div>
      }
    />
  );

  const minimal = <MiniDot><Ring value={progress} color={accent} name={d.icon} /></MiniDot>;

  return { lock, compact, expanded, minimal };
}

/** "label · value" when a label is set, else just the value (LiveStageUI footerLeft). */
function labelValue(label: string | null | undefined, value: string): string {
  return label && label.trim() ? `${label} · ${value}` : value;
}

// --- live preview (real session content, not sample text) -----------------------------------------

/**
 * The Lock Screen surface rendered from a session's ACTUAL current state and its frozen start
 * attributes, so the session explorer shows what the activity looks like right now. Same visibility,
 * priority, and terminal rules as the sample builders above; countdown values self-tick like the
 * device's timer. Still an approximation - the iOS renderer owns the pixels.
 */
export function LiveLockPreview(props: { payload: TemplatePayload; attributes: AdminSessionAttributes }) {
  // Ticks once a second so time-based values run instead of freezing at render time.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const icon = props.attributes.iconIdentifier ?? "airplane";
  const rawAccent = (props.attributes.accentStyle ?? "blue") as AccentStyle;
  const accentStyle: AccentStyle = ACCENT_HEX[rawAccent] ? rawAccent : "blue";
  const labels = props.attributes.labels ?? {};

  switch (props.payload.type) {
    case "countdown":
      return liveCountdownLock(props.payload, icon, accentStyle, labels, nowMs);
    case "progress":
      return liveProgressLock(props.payload, icon, accentStyle, labels);
    default:
      return liveJourneyLock(props.payload, icon, accentStyle, labels, nowMs);
  }
}

function liveJourneyLock(p: JourneyPayload, icon: string, accentStyle: AccentStyle, labels: TemplateLabels, nowMs: number) {
  const accent = ACCENT_HEX[accentStyle]; // Journey has no terminal styling, exactly as the renderer
  const cd = p.targetDate ? countdownString(p.targetDate, nowMs) : null;
  return (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={icon} color={accent} />
        {p.statusText && <span className="pv-accent" style={{ color: accent }}>{p.statusText}</span>}
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">{p.title}</div>
      <div className="pv-sub pv-clamp1">{p.currentStep}</div>
      {p.progress != null && <Bar value={p.progress} color={accent} />}
      <div className="pv-foot">
        {p.nextStep && <span className="pv-muted pv-clamp1">{labelValue(labels.nextStepLabel, p.nextStep)}</span>}
        <span className="pv-spacer" />
        {cd && (
          <span className="pv-foot-right">
            {labels.targetLabel && <span className="pv-muted">{labels.targetLabel}</span>}
            <span className="pv-strong">{cd}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function liveCountdownLock(p: CountdownPayload, icon: string, accentStyle: AccentStyle, labels: TemplateLabels, nowMs: number) {
  const cd = countdownString(p.targetDate, nowMs);
  const terminal = cd === null; // target reached: muted accent + check + zeroStateLabel
  const accent = tint(accentStyle, terminal);
  const zero = labels.zeroStateLabel && labels.zeroStateLabel.trim() ? labels.zeroStateLabel : "0:00";
  const subtitleLine = [p.subtitle, p.location].filter(Boolean).join(" · ");
  return (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={icon} color={accent} />
        {terminal && <Check color={accent} />}
        {p.statusText && <span className="pv-accent" style={{ color: accent }}>{p.statusText}</span>}
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">{p.title}</div>
      {subtitleLine && <div className="pv-sub pv-clamp1">{subtitleLine}</div>}
      <div className="pv-foot">
        {labels.countdownLabel && <span className="pv-muted">{labels.countdownLabel}</span>}
        <span className="pv-spacer" />
        <span className="pv-strong pv-big" style={{ color: accent }}>{terminal ? zero : cd}</span>
      </div>
    </div>
  );
}

function liveProgressLock(p: ProgressPayload, icon: string, accentStyle: AccentStyle, labels: TemplateLabels) {
  const terminal = p.progress >= 1;
  const accent = tint(accentStyle, terminal);
  const time = p.estimatedCompletionDate
    ? new Date(p.estimatedCompletionDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  // completionTime joins the label and time with a space ("Done 14:30"), not the nextStep "·".
  const cl = labels.completionLabel;
  const completion = time ? (cl && cl.trim() ? `${cl} ${time}` : time) : null;
  return (
    <div className="pv-lock">
      <div className="pv-lock-head">
        <Icon name={icon} color={accent} />
        {terminal && <Check color={accent} />}
        <span className="pv-spacer" />
        <span className="pv-muted">now</span>
      </div>
      <div className="pv-title-line pv-clamp2">{p.title}</div>
      {p.currentStage && <div className="pv-sub pv-clamp1">{p.currentStage}</div>}
      <Bar value={p.progress} color={accent} />
      <div className="pv-foot">
        {p.detailText && <span className="pv-muted pv-clamp1">{p.detailText}</span>}
        <span className="pv-spacer" />
        {completion && <span className="pv-strong pv-muted">{completion}</span>}
      </div>
    </div>
  );
}

/** "H:MM:SS" / "M:SS" until the target, or null once it has passed (the terminal state). */
function countdownString(targetIso: string, nowMs: number): string | null {
  const ms = Date.parse(targetIso) - nowMs;
  if (Number.isNaN(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
