import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';

jest.mock('../config/stellar', () => ({
  sorobanRpcClient: { simulateTransaction: jest.fn() },
  networkPassphrase: 'Test SDF Network ; September 2015',
}));

jest.mock('../middleware/logger', () => ({
  appLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { sorobanRpcClient } from '../config/stellar';
import { StellarSimulator } from '../services/stellar.simulator';

const mockSimulate = sorobanRpcClient.simulateTransaction as jest.Mock;
const PASSPHRASE = 'Test SDF Network ; September 2015';

function makeSimulator() {
  return new StellarSimulator(sorobanRpcClient as unknown as rpc.Server, PASSPHRASE);
}

beforeEach(() => jest.clearAllMocks());

describe('StellarSimulator — invalid XDR', () => {
  it('returns success:false with error message for invalid XDR', async () => {
    const sim = makeSimulator();
    const result = await sim.simulate('not-valid-xdr');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid XDR/i);
    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe('StellarSimulator — simulation success', () => {
  it('returns success:true with simulatedFee and result', async () => {
    jest.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({} as any);

    mockSimulate.mockResolvedValue({
      minResourceFee: '12345',
      result: { retval: 'ok' },
      events: [],
      error: undefined,
      restorePreamble: undefined,
    });

    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(false);
    jest.spyOn(rpc.Api, 'isSimulationRestore').mockReturnValue(false);

    const sim = makeSimulator();
    const result = await sim.simulate('fake-xdr');

    expect(result.success).toBe(true);
    expect(result.simulatedFee).toBe('12345');
    expect(result.error).toBeUndefined();
  });
});

describe('StellarSimulator — simulation failure', () => {
  it('returns success:false when simulation returns an error response', async () => {
    jest.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({} as any);

    const errorResponse = { error: 'HostError: contract panic' };
    mockSimulate.mockResolvedValue(errorResponse);

    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);
    jest.spyOn(rpc.Api, 'isSimulationRestore').mockReturnValue(false);

    const sim = makeSimulator();
    const result = await sim.simulate('fake-xdr');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HostError');
  });

  it('returns success:false when restore is required', async () => {
    jest.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({} as any);
    mockSimulate.mockResolvedValue({ restorePreamble: {} });

    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(false);
    jest.spyOn(rpc.Api, 'isSimulationRestore').mockReturnValue(true);

    const sim = makeSimulator();
    const result = await sim.simulate('fake-xdr');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/restore/i);
  });
});

describe('StellarSimulator — network error', () => {
  it('returns success:false on RPC network error', async () => {
    jest.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({} as any);
    mockSimulate.mockRejectedValue(new Error('ECONNREFUSED'));

    const sim = makeSimulator();
    const result = await sim.simulate('fake-xdr');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Network error/i);
  });
});
