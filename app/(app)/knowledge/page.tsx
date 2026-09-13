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
      <div>
        <h1 className="text-lg font-semibold">Knowledge</h1>
        <p className="text-muted-foreground text-sm">Documents, lessons, strategy notes, and trade reviews.</p>
      </div>
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
        <EmptyState
          icon={BookOpen}
          title="No documents yet"
          description="Trade reviews and research notes will populate this knowledge base as the system generates them."
        />
      )}
    </div>
  );
}
