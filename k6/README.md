# k6 Load Testing Suite

Load testing scripts for Amana backend endpoints and Stellar submission simulation.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed

## Scripts

### `load-test.js`
Simulates the full trade lifecycle under concurrent load:
- Create trade
- List trades
- Build deposit transaction
- Confirm delivery
- Initiate dispute

Run:
```bash
k6 run k6/load-test.js
```

### `stellar-sim.js`
Simulates Stellar RPC submissions as the backend would experience them:
- Account lookups
- Transaction simulation
- Transaction submission
- Transaction status polling
- Stellar fees endpoint

Run:
```bash
k6 run k6/stellar-sim.js
```

### Custom Options

Set environment variables to configure:
```bash
BASE_URL=http://localhost:3001 STELLAR_RPC_URL=https://soroban-testnet.stellar.org k6 run k6/load-test.js
```

### Options

- `loadOptions` - Standard load test (ramp up to 20 users)
- `soakOptions` - Endurance/soak test (5 users for 20 minutes)
- `stressOptions` - Stress test (ramp up to 200 users)

Modify `options.js` to change thresholds and stages.
