import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";

export default async function KnowledgePage() {
  const supabase = await createClient();
  const { data: docs } = await supabase.from("knowledge_documents").select("*").order("created_at", { ascending: false }).limit(50);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Knowledge</h1>
      {docs && docs.length > 0 ? (
        <div className="grid gap-3">
          {docs.map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{d.title}</CardTitle>
                <Badge variant="outline">{d.source_type}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground line-clamp-2 text-sm">{d.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="Nothing here yet" />
      )}
    </div>
  );
}
