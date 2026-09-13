import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveAndExecuteSignal } from "@/lib/trading/execute";

/** Dashboard "Approve" action. Requires an authenticated session (RLS-protected read used to verify). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const outcome = await approveAndExecuteSignal(id, "dashboard");
  return NextResponse.json(outcome);
}
