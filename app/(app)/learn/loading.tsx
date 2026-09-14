import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-80" />
      </div>
      <CardGridSkeleton />
    </div>
  );
}
