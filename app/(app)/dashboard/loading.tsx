import { Skeleton } from "@/components/ui/skeleton";
import { CardGridSkeleton, MetricRowSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-24" />
        </div>
      </section>
      <MetricRowSkeleton />
      <CardGridSkeleton count={2} className="grid gap-4 xl:grid-cols-3" />
      <CardGridSkeleton count={2} className="grid gap-4 xl:grid-cols-3" />
    </div>
  );
}
