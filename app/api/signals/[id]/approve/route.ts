import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveAndExecuteSignal } from "@/lib/trading/execute";
import { isOwner } from "@/lib/auth/authorization";

/** Dashboard "Approve" action. Requires an authenticated session (RLS-protected read used to verify). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  const { id } = await params;
  const outcome = await approveAndExecuteSignal(id, "dashboard", supabase);
  return NextResponse.json(outcome);
}
