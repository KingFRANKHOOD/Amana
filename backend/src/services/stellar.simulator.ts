import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { sorobanRpcClient, networkPassphrase } from '../config/stellar';
import { appLogger } from '../middleware/logger';

export interface SimulationResult {
  success: boolean;
  simulatedFee?: string;
  result?: unknown;
  diagnosticEvents?: unknown[];
  error?: string;
}

export class StellarSimulator {
  private sorobanRpc: rpc.Server;
  private passphrase: string;

  constructor(
    sorobanRpc: rpc.Server = sorobanRpcClient,
    passphrase: string = networkPassphrase,
  ) {
    this.sorobanRpc = sorobanRpc;
    this.passphrase = passphrase;
  }

  async simulate(unsignedXdr: string): Promise<SimulationResult> {
    let tx;
    try {
      tx = TransactionBuilder.fromXDR(unsignedXdr, this.passphrase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Invalid XDR: ${msg}` };
    }

    try {
      const simResult = await this.sorobanRpc.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(simResult)) {
        appLogger.warn({ error: simResult.error }, 'Stellar simulation failed');
        return { success: false, error: simResult.error };
      }

      if (rpc.Api.isSimulationRestore(simResult)) {
        return {
          success: false,
          error: 'Transaction requires ledger entry restore before execution',
        };
      }

      return {
        success: true,
        simulatedFee: simResult.minResourceFee,
        result: simResult.result,
        diagnosticEvents: simResult.events,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.error({ error: err }, 'Stellar simulation network error');
      return { success: false, error: `Network error: ${msg}` };
    }
  }
}

export const stellarSimulator = new StellarSimulator();
