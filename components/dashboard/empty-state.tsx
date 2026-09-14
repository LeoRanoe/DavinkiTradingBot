import type { LucideIcon } from "lucide-react";

/** Compact, unboxed empty state. Description is optional - add one only
 * when it tells the user something actionable, not just "why is this empty". */
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-10 text-center">
      <Icon className="text-muted-foreground/70 mb-1 size-5" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-sm text-xs">{description}</p> : null}
    </div>
  );
}
