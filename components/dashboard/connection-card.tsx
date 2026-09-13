"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Field = { name: string; label: string; type: "text" | "password"; placeholder?: string };

export function ConnectionCard({
  integration,
  title,
  status,
  source,
  fields,
  readOnlyNote,
}: {
  integration: string;
  title: string;
  status: "Configured" | "Not configured";
  source?: string;
  fields: Field[];
  readOnlyNote?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration, ...values }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Save failed");
      toast.success(`${title} settings saved.`);
      setValues({}); // never keep the secret in the input after saving
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration }),
      });
      const body = await res.json();
      if (body.status === "OK" || body.ok) toast.success("Connected");
      else if (body.status === "NOT_CONFIGURED") toast.warning("Not configured");
      else toast.error(body.message ?? "Connection failed");
    } catch {
      toast.error("Connection failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-2">
          {source ? <Badge variant="secondary">{source}</Badge> : null}
          <Badge variant={status === "Configured" ? "default" : "outline"}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnlyNote ? (
          <p className="text-muted-foreground text-sm">{readOnlyNote}</p>
        ) : (
          <>
            {fields.map((f) => (
              <div key={f.name} className="flex flex-col gap-2">
                <Label htmlFor={`${integration}-${f.name}`}>{f.label}</Label>
                <Input
                  id={`${integration}-${f.name}`}
                  type={f.type}
                  placeholder={f.type === "password" ? "••••••••••••" : f.placeholder}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={test} disabled={testing}>
                {testing ? "Testing..." : "Test connection"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
