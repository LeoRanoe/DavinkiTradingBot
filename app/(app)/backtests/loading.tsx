import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-80" />
      </div>
      <TableSkeleton />
    </div>
  );
}
