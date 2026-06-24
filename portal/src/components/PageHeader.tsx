import type { ReactNode } from "react";

// A consistent page title block for every console tab: a title, an optional one-line subtitle, and an
// optional action area on the right (refresh, "new", a last-refreshed timestamp). Keeps the five
// screens visually uniform instead of each starting straight into a card.
export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1 className="page-title">{props.title}</h1>
        {props.subtitle && <p className="page-sub">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}
