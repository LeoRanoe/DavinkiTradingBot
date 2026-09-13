import { getQwenConfiguration, getTelegramConfiguration, getBybitDemoConfiguration } from "@/lib/config/integrations";
import { ConnectionCard } from "@/components/dashboard/connection-card";

export default async function ConnectionsPage() {
  const [qwen, telegram, demo] = await Promise.all([
    getQwenConfiguration(),
    getTelegramConfiguration(),
    getBybitDemoConfiguration(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Connections</h1>
        <p className="text-muted-foreground text-sm">
          Replace integration credentials without redeploying. Existing secrets are never shown - only a new value
          can be entered.
        </p>
      </div>

      <ConnectionCard
        integration="qwen"
        title="Qwen"
        status={qwen ? "Configured" : "Not configured"}
        source={qwen?.source === "vault" ? "Dashboard" : qwen?.source === "env" ? "Environment" : undefined}
        fields={[
          { name: "apiKey", label: "API key", type: "password", placeholder: "sk-..." },
          { name: "baseUrl", label: "Base URL", type: "text", placeholder: qwen?.baseUrl ?? "https://..." },
          { name: "model", label: "Model", type: "text", placeholder: qwen?.model ?? "qwen-turbo" },
        ]}
      />

      <ConnectionCard
        integration="telegram"
        title="Telegram"
        status={telegram ? "Configured" : "Not configured"}
        source={telegram?.source === "vault" ? "Dashboard" : telegram?.source === "env" ? "Environment" : undefined}
        fields={[
          { name: "botToken", label: "Bot token", type: "password", placeholder: "123:ABC..." },
          { name: "ownerUserId", label: "Owner user ID", type: "text", placeholder: "your Telegram user id" },
          { name: "chatId", label: "Chat ID", type: "text", placeholder: "chat id for notifications" },
        ]}
      />

      <ConnectionCard
        integration="bybit_demo"
        title="Bybit Demo"
        status={demo ? "Configured" : "Not configured"}
        source={demo?.source === "vault" ? "Dashboard" : demo?.source === "env" ? "Environment" : undefined}
        readOnlyNote="Demo credential configuration ships in a later phase. Only OBSERVE and PAPER modes are active in this build; Bybit Demo execution is not yet implemented. LIVE Bybit credentials are never requested."
        fields={[]}
      />
    </div>
  );
}
