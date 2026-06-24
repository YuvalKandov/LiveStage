import { useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";

// A small copy-to-clipboard button with a transient "Copied" confirmation. Used for API keys (the
// secret shown once) and identifiers like template ids, so the console feels operated rather than
// read-only. Falls back to a visible error state if the Clipboard API is unavailable (for example a
// non-secure context), never failing silently.
export function CopyButton(props: { text: string; label?: ReactNode; title?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button type="button" className="copy-btn" onClick={copy} title={props.title ?? "Copy"}>
      {state === "copied" ? <Check size={13} /> : <Copy size={13} />}
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : props.label ?? "Copy"}
    </button>
  );
}
