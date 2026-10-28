// Owned by S7a. Module-level singletons for the generate routes; tests swap them with setGenerateServicesForTests.
import { createBalanceReader } from '../clippy/balance';
import { createClippyClient, type ClippyClient } from '../clippy/mcp';
import { loadEnv } from '../env';
import { createApprovalStore, type ApprovalStore } from './approval';

export interface GenerateServices {
  approvals: ApprovalStore;
  clippy: ClippyClient | undefined;
  balance: { read(): Promise<number | undefined> };
}

let services: GenerateServices | undefined;

export function getGenerateServices(): GenerateServices {
  if (!services) {
    const env = loadEnv();
    const clippy = env.CLIPPY_MCP_URL && env.CLIPPY_TOKEN ? createClippyClient({ url: env.CLIPPY_MCP_URL, token: env.CLIPPY_TOKEN }) : undefined;
    services = { approvals: createApprovalStore(), clippy, balance: createBalanceReader(clippy) };
  }
  return services;
}

export function setGenerateServicesForTests(s: GenerateServices | undefined): void {
  services = s;
}
