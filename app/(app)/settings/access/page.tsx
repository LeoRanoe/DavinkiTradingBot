import { redirect } from "next/navigation";
import { GuestAccessManager } from "@/components/settings/guest-access-manager";
import { isOwner } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

export default async function GuestAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isOwner(user)) redirect("/dashboard");

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Access</h1>
      <GuestAccessManager />
    </div>
  );
}
