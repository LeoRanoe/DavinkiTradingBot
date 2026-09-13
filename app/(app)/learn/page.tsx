import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap } from "lucide-react";

export default async function LearnPage() {
  const supabase = await createClient();
  const { data: lessons } = await supabase.from("lessons").select("*").order("created_at", { ascending: false }).limit(50);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Learn</h1>
        <p className="text-muted-foreground text-sm">Short lessons grounded in what the system has actually observed.</p>
      </div>
      {lessons && lessons.length > 0 ? (
        <div className="grid gap-3">
          {lessons.map((l) => (
            <Card key={l.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{l.title}</CardTitle>
                <Badge variant="outline">{l.status}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{l.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GraduationCap}
          title="No lessons yet"
          description="Lessons are generated from real signals and trades - check back after the scanner has run a few times."
        />
      )}
    </div>
  );
}
