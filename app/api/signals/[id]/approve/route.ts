import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveAndExecuteSignal } from "@/lib/trading/execute";
import { isOwner } from "@/lib/auth/authorization";

/**
 * Dashboard "Approve". Identical authority to the Telegram button: it only
 * REQUESTS execution, and `approveAndExecuteSignal` re-runs the full
 * deterministic revalidation against fresh market data before anything
 * opens. The atomic PENDING -> OPENING claim means a dashboard click and a
 * Telegram tap racing each other still produce at most one position.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const { id } = await params;
  const outcome = await approveAndExecuteSignal(id, "dashboard", supabase);

  const status = outcome.kind === "NOT_FOUND" ? 404 : 200;
  return NextResponse.json(outcome, { status });
}
