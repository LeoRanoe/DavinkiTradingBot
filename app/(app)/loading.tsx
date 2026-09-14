import { DashboardPageSkeleton } from "@/components/dashboard/page-skeleton";

// Fallback shell shown on any dashboard route that does not define its own
// more specific `loading.tsx`, so navigation never appears to hang.
export default function Loading() {
  return <DashboardPageSkeleton />;
}
