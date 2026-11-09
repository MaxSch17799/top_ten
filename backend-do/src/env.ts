import type { DbEnv } from './questionBanksDb.js';
import type { UsageMonitorEnv } from './usageMonitor.js';

/** Worker bindings. Keep resource identities in Wrangler config, not game registration. */
export interface Env extends DbEnv, UsageMonitorEnv {
  GAME_DO: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}
