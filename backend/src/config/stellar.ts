import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';
import { env } from './env';
import { appLogger } from '../middleware/logger';

export const USDC_ISSUER_MAINNET = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
// Testnet USDC issuer — override via USDC_ISSUER env var if a specific testnet asset is needed.
export const USDC_ISSUER_TESTNET =
  process.env.USDC_ISSUER ?? "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";

// Read network configuration from environment
const stellarNetwork = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
export const networkType: 'testnet' | 'mainnet' = stellarNetwork === 'mainnet' ? 'mainnet' : 'testnet';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

export const defaultHorizonUrl = networkType === 'testnet'
  ? 'https://horizon-testnet.stellar.org'
  : 'https://horizon.stellar.org';

export const defaultRpcUrl = networkType === 'testnet'
  ? 'https://soroban-testnet.stellar.org'
  : 'https://soroban-rpc.stellar.org';

export const networkPassphrase = env.STELLAR_NETWORK_PASSPHRASE
  ?? (networkType === 'testnet' ? Networks.TESTNET : Networks.PUBLIC);

export interface StellarRpcNodeStatus {
  url: string;
  isPrimary: boolean;
  isActive: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  lastChecked: string;
  consecutiveFailures: number;
  lastError?: string;
  latestLedger?: number;
}

export interface StellarHorizonNodeStatus {
  url: string;
  isPrimary: boolean;
  isActive: boolean;
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  lastChecked: string;
  lastError?: string;
}

export interface StellarNetworkHealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  network: string;
  activeRpcUrl: string;
  primaryRpcUrl: string;
  fallbackRpcUrls: string[];
  nodes: StellarRpcNodeStatus[];
  activeHorizonUrl: string;
  horizonNodes: StellarHorizonNodeStatus[];
  latestLedger?: number;
  responseTime: number;
}

interface NodeState {
  url: string;
  client: rpc.Server;
  isPrimary: boolean;
  consecutiveFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  lastError?: string;
  lastLatencyMs: number;
  latestLedger?: number;
}

interface HorizonNodeState {
  url: string;
  server: Horizon.Server;
  isPrimary: boolean;
  consecutiveFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  lastError?: string;
  lastLatencyMs: number;
}

export class StellarRpcManager {
  private rpcNodes: NodeState[] = [];
  private horizonNodes: HorizonNodeState[] = [];
  private activeRpcIndex: number = 0;
  private activeHorizonIndex: number = 0;
  private readonly cooldownMs: number = 60_000;
  private readonly maxFailuresBeforeSwitch: number = 2;
  private onFailoverListeners: Array<(fromUrl: string, toUrl: string, reason: string) => void> = [];

  constructor() {
    this.initializeNodes();
  }

  public initializeNodes(): void {
    const primaryRpc = env.STELLAR_RPC_URL || defaultRpcUrl;
    const fallbackRpcRaw = env.STELLAR_RPC_FALLBACK_URLS || '';

    const fallbackRpcList = fallbackRpcRaw
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && u !== primaryRpc);

    const allRpcUrls = [primaryRpc, ...fallbackRpcList];
    const uniqueRpcUrls = Array.from(new Set(allRpcUrls));

    this.rpcNodes = uniqueRpcUrls.map((url, idx) => ({
      url,
      client: new rpc.Server(url),
      isPrimary: idx === 0,
      consecutiveFailures: 0,
      lastLatencyMs: 0,
    }));
    this.activeRpcIndex = 0;

    const primaryHorizon = defaultHorizonUrl;
    const fallbackHorizonRaw = env.STELLAR_HORIZON_FALLBACK_URLS || '';
    const fallbackHorizonList = fallbackHorizonRaw
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && u !== primaryHorizon);

    const allHorizonUrls = [primaryHorizon, ...fallbackHorizonList];
    const uniqueHorizonUrls = Array.from(new Set(allHorizonUrls));

    this.horizonNodes = uniqueHorizonUrls.map((url, idx) => ({
      url,
      server: new Horizon.Server(url),
      isPrimary: idx === 0,
      consecutiveFailures: 0,
      lastLatencyMs: 0,
    }));
    this.activeHorizonIndex = 0;
  }

  public getActiveRpcUrl(): string {
    return this.rpcNodes[this.activeRpcIndex]?.url ?? defaultRpcUrl;
  }

  public getPrimaryRpcUrl(): string {
    return this.rpcNodes[0]?.url ?? defaultRpcUrl;
  }

  public getFallbackRpcUrls(): string[] {
    return this.rpcNodes.slice(1).map((n) => n.url);
  }

  public getActiveRpcClient(): rpc.Server {
    return this.rpcNodes[this.activeRpcIndex]?.client ?? new rpc.Server(defaultRpcUrl);
  }

  public getActiveHorizonUrl(): string {
    return this.horizonNodes[this.activeHorizonIndex]?.url ?? defaultHorizonUrl;
  }

  public getActiveHorizonServer(): Horizon.Server {
    return this.horizonNodes[this.activeHorizonIndex]?.server ?? new Horizon.Server(defaultHorizonUrl);
  }

  public onFailover(listener: (fromUrl: string, toUrl: string, reason: string) => void): void {
    this.onFailoverListeners.push(listener);
  }

  private notifyFailover(fromUrl: string, toUrl: string, reason: string): void {
    appLogger.warn({ fromUrl, toUrl, reason }, "Stellar RPC failover triggered");
    for (const listener of this.onFailoverListeners) {
      try {
        listener(fromUrl, toUrl, reason);
      } catch (err) {
        appLogger.error({ error: err }, "Error in failover listener");
      }
    }
  }

  public async executeRpcWithFallback<T>(
    operation: (client: rpc.Server, url: string) => Promise<T>,
  ): Promise<T> {
    const startIndex = this.activeRpcIndex;
    const totalNodes = this.rpcNodes.length;
    let lastError: unknown;

    for (let offset = 0; offset < totalNodes; offset++) {
      const currentIndex = (startIndex + offset) % totalNodes;
      const node = this.rpcNodes[currentIndex];
      if (!node) continue;

      const now = Date.now();
      if (
        node.consecutiveFailures >= this.maxFailuresBeforeSwitch &&
        node.lastFailureTime &&
        now - node.lastFailureTime < this.cooldownMs &&
        offset === 0 &&
        totalNodes > 1
      ) {
        continue;
      }

      const start = Date.now();
      try {
        const result = await operation(node.client, node.url);
        node.lastSuccessTime = Date.now();
        node.consecutiveFailures = 0;
        node.lastLatencyMs = Date.now() - start;
        node.lastError = undefined;

        if (this.activeRpcIndex !== currentIndex) {
          const prevUrl = this.rpcNodes[this.activeRpcIndex]?.url ?? "unknown";
          this.activeRpcIndex = currentIndex;
          this.notifyFailover(prevUrl, node.url, "Switched to healthy node after successful call");
        }

        return result;
      } catch (error) {
        lastError = error;
        node.consecutiveFailures += 1;
        node.lastFailureTime = Date.now();
        node.lastLatencyMs = Date.now() - start;
        node.lastError = error instanceof Error ? error.message : String(error);

        appLogger.warn(
          { url: node.url, consecutiveFailures: node.consecutiveFailures, error: node.lastError },
          "Stellar RPC call failed on node",
        );

        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (offset < totalNodes - 1) {
          const nextIndex = (currentIndex + 1) % totalNodes;
          const nextNode = this.rpcNodes[nextIndex];
          if (nextNode) {
            this.activeRpcIndex = nextIndex;
            this.notifyFailover(
              node.url,
              nextNode.url,
              `Node failed with error: ${node.lastError}`,
            );
          }
        }
      }
    }

    throw lastError;
  }

  public async executeHorizonWithFallback<T>(
    operation: (server: Horizon.Server, url: string) => Promise<T>,
  ): Promise<T> {
    const startIndex = this.activeHorizonIndex;
    const totalNodes = this.horizonNodes.length;
    let lastError: unknown;

    for (let offset = 0; offset < totalNodes; offset++) {
      const currentIndex = (startIndex + offset) % totalNodes;
      const node = this.horizonNodes[currentIndex];
      if (!node) continue;

      const start = Date.now();
      try {
        const result = await operation(node.server, node.url);
        node.lastSuccessTime = Date.now();
        node.consecutiveFailures = 0;
        node.lastLatencyMs = Date.now() - start;
        node.lastError = undefined;

        if (this.activeHorizonIndex !== currentIndex) {
          this.activeHorizonIndex = currentIndex;
        }

        return result;
      } catch (error) {
        lastError = error;
        node.consecutiveFailures += 1;
        node.lastFailureTime = Date.now();
        node.lastLatencyMs = Date.now() - start;
        node.lastError = error instanceof Error ? error.message : String(error);

        if (this.isNonRetryableError(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private isNonRetryableError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    const status =
      error !== null &&
      typeof error === 'object' &&
      'response' in error &&
      error.response !== null &&
      typeof error.response === 'object' &&
      'status' in error.response
        ? (error.response as { status: unknown }).status
        : undefined;

    if (status === 400 || status === 404) return true;
    if (/invalid.*xdr|contract panic|invalid public key|not found/i.test(msg)) return true;
    return false;
  }

  public async checkRpcNode(node: NodeState, timeoutMs: number = 5000): Promise<StellarRpcNodeStatus> {
    const start = Date.now();
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let errorMessage: string | undefined;
    let ledgerSeq: number | undefined;

    try {
      const checkPromise = (async () => {
        if (typeof node.client.getLatestLedger === 'function') {
          const ledger = await node.client.getLatestLedger();
          return ledger?.sequence;
        }
        if (typeof (node.client as any).getHealth === 'function') {
          const health = await (node.client as any).getHealth();
          return health?.latestLedger;
        }
        return undefined;
      })();

      ledgerSeq = await withTimeout(checkPromise, timeoutMs, `RPC health check timed out after ${timeoutMs}ms`);
      const latency = Date.now() - start;
      node.lastLatencyMs = latency;
      node.latestLedger = ledgerSeq;
      node.consecutiveFailures = 0;
      node.lastSuccessTime = Date.now();

      if (latency > 2000) {
        status = 'degraded';
      }
    } catch (err) {
      const latency = Date.now() - start;
      node.lastLatencyMs = latency;
      node.consecutiveFailures += 1;
      node.lastFailureTime = Date.now();
      errorMessage = err instanceof Error ? err.message : String(err);
      node.lastError = errorMessage;
      status = 'unhealthy';
    }

    return {
      url: node.url,
      isPrimary: node.isPrimary,
      isActive: this.rpcNodes[this.activeRpcIndex]?.url === node.url,
      status,
      latencyMs: node.lastLatencyMs,
      lastChecked: new Date().toISOString(),
      consecutiveFailures: node.consecutiveFailures,
      lastError: errorMessage,
      latestLedger: ledgerSeq,
    };
  }

  public async checkHorizonNode(
    node: HorizonNodeState,
    accountToCheck?: string,
    timeoutMs: number = 5000,
  ): Promise<StellarHorizonNodeStatus> {
    const start = Date.now();
    let status: 'healthy' | 'unhealthy' = 'healthy';
    let errorMessage: string | undefined;

    try {
      const checkPromise = (async () => {
        if (accountToCheck) {
          await node.server.loadAccount(accountToCheck);
        } else if (typeof node.server.feeStats === 'function') {
          await node.server.feeStats();
        }
      })();

      await withTimeout(checkPromise, timeoutMs, `Horizon health check timed out after ${timeoutMs}ms`);
      node.lastLatencyMs = Date.now() - start;
      node.consecutiveFailures = 0;
      node.lastSuccessTime = Date.now();
    } catch (err) {
      node.lastLatencyMs = Date.now() - start;
      node.consecutiveFailures += 1;
      node.lastFailureTime = Date.now();
      errorMessage = err instanceof Error ? err.message : String(err);
      node.lastError = errorMessage;
      status = 'unhealthy';
    }

    return {
      url: node.url,
      isPrimary: node.isPrimary,
      isActive: this.horizonNodes[this.activeHorizonIndex]?.url === node.url,
      status,
      latencyMs: node.lastLatencyMs,
      lastChecked: new Date().toISOString(),
      lastError: errorMessage,
    };
  }

  public async checkNetworkHealth(
    accountToCheck?: string,
    timeoutMs: number = 5000,
  ): Promise<StellarNetworkHealthResult> {
    const start = Date.now();

    const [rpcResults, horizonResults] = await Promise.all([
      Promise.all(this.rpcNodes.map((n) => this.checkRpcNode(n, timeoutMs))),
      Promise.all(this.horizonNodes.map((n) => this.checkHorizonNode(n, accountToCheck, timeoutMs))),
    ]);

    const activeNode = rpcResults.find((n) => n.isActive) ?? rpcResults[0];
    const primaryNode = rpcResults.find((n) => n.isPrimary) ?? rpcResults[0];
    const healthyRpcNodes = rpcResults.filter((n) => n.status === 'healthy' || n.status === 'degraded');
    const healthyHorizonNodes = horizonResults.filter((n) => n.status === 'healthy');

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let message = 'Stellar network and RPC connectivity healthy';

    if (healthyRpcNodes.length === 0 || healthyHorizonNodes.length === 0) {
      overallStatus = 'unhealthy';
      message = `All Stellar RPC or Horizon endpoints unreachable (${rpcResults[0]?.lastError || 'Connection failed'})`;
    } else if (!primaryNode || primaryNode.status === 'unhealthy') {
      overallStatus = 'degraded';
      message = `Primary Stellar RPC node down, operating on fallback (${activeNode?.url})`;
    } else if (activeNode && activeNode.status === 'degraded') {
      overallStatus = 'degraded';
      message = `Stellar RPC node response latency degraded (${activeNode.latencyMs}ms)`;
    } else if (rpcResults.some((n) => n.status === 'unhealthy')) {
      overallStatus = 'degraded';
      message = `Some fallback Stellar RPC nodes are unavailable`;
    }

    const latestLedger = rpcResults.find((n) => n.latestLedger !== undefined)?.latestLedger;

    return {
      status: overallStatus,
      message,
      network: networkType,
      activeRpcUrl: this.getActiveRpcUrl(),
      primaryRpcUrl: this.getPrimaryRpcUrl(),
      fallbackRpcUrls: this.getFallbackRpcUrls(),
      nodes: rpcResults,
      activeHorizonUrl: this.getActiveHorizonUrl(),
      horizonNodes: horizonResults,
      latestLedger,
      responseTime: Date.now() - start,
    };
  }

  public reset(): void {
    this.initializeNodes();
  }
}

export const stellarRpcManager = new StellarRpcManager();

// Create dynamic proxy objects for backwards compatibility with direct imports
export const sorobanRpcClient = new Proxy({} as rpc.Server, {
  get(_target, prop) {
    const activeClient = stellarRpcManager.getActiveRpcClient() as any;
    const value = activeClient[prop];
    if (typeof value === 'function') {
      return value.bind(activeClient);
    }
    return value;
  },
});

export const horizonServer = new Proxy({} as Horizon.Server, {
  get(_target, prop) {
    const activeServer = stellarRpcManager.getActiveHorizonServer() as any;
    const value = activeServer[prop];
    if (typeof value === 'function') {
      return value.bind(activeServer);
    }
    return value;
  },
});

