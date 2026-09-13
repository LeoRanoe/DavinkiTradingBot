import { getBybitDemoConfiguration } from "@/lib/config/integrations";

/**
 * Bybit Demo trading client interface (spec Phase 15). Demo credentials were
 * not supplied in this environment, so this is the interface plus a mock
 * implementation used for tests - never a real order path. LIVE credentials
 * must never be requested or wired here.
 */
export type DemoOrderRequest = {
  clientOrderId: string;
  symbol: string;
  side: "Buy";
  qty: number;
  orderType: "Market" | "Limit";
  price?: number;
};

export type DemoOrderResult =
  | { status: "SUBMITTED"; exchangeOrderId: string }
  | { status: "UNAVAILABLE"; reason: "NOT_CONFIGURED" | "API_ERROR"; message?: string };

export async function isDemoTradingConfigured(): Promise<boolean> {
  const config = await getBybitDemoConfiguration();
  return config !== null;
}

/**
 * Places a Demo-account order. Not implemented against the live Bybit Demo
 * REST API yet (no credentials to test against) - returns UNAVAILABLE until
 * BYBIT_DEMO_API_KEY/SECRET (or a dashboard-configured equivalent) exist.
 * When implemented, this MUST: persist order intent before submission, use
 * a deterministic client_order_id, and reconcile status after a timeout
 * rather than blindly resubmitting (spec #49).
 */
export async function submitDemoOrder(_request: DemoOrderRequest): Promise<DemoOrderResult> {
  const config = await getBybitDemoConfiguration();
  if (!config) {
    return { status: "UNAVAILABLE", reason: "NOT_CONFIGURED", message: "Bybit Demo credentials are not configured." };
  }
  // Real implementation pending credentials to develop/test against.
  return { status: "UNAVAILABLE", reason: "API_ERROR", message: "Bybit Demo execution is not yet implemented." };
}
