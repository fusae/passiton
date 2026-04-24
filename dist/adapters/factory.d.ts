import type { AgentConfig, Adapter } from '../types.js';
import type { Router } from '../router.js';
export declare function createAdapter(agentCfg: AgentConfig): Adapter | undefined;
export declare function registerConfiguredAdapters(router: Router, agents: Record<string, AgentConfig>): void;
//# sourceMappingURL=factory.d.ts.map