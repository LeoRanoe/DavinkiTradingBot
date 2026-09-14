import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared route-loading skeletons, used by the various `loading.tsx` files
 * under `app/(app)/*`. Intentionally lightweight - these exist purely for
 * perceived responsiveness (Next.js shows them immediately on navigation
 * while the route's Server Component data resolves), not as a pixel-exact
 * preview of the final layout.
 */

export function MetricRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={className ?? "grid gap-4 xl:grid-cols-3"}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Generic full-page shell: title row + metrics + a couple of content cards. */
export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b pb-5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <MetricRowSkeleton />
      <CardGridSkeleton />
    </div>
  );
}
