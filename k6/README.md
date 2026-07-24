# k6 Load Testing Suite

This folder contains reproducible k6 scenarios for the Amana trade API and Stellar-facing paths. The main throughput script exercises realistic trade creation and settlement flows under increasing load so the team can observe scaling limits and regressions.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed
- A running backend on the target base URL (default: http://localhost:3001)

## Scripts

### `trade-throughput.js`
Runs two load scenarios in one script:
- `createTrades`: ramps arrival rate for trade creation and listing
- `settleTrades`: simulates trade funding, delivery confirmation, and dispute initiation in a settlement-focused flow

Run the mixed scenario:
```bash
k6 run k6/trade-throughput.js
```

Run just the creation-focused scenario:
```bash
k6 run k6/trade-throughput.js --env SCENARIO=creation
```

Run just the settlement-focused scenario:
```bash
k6 run k6/trade-throughput.js --env SCENARIO=settlement
```

Generate a JSON summary report:
```bash
k6 run --summary-export=k6/reports/trade-throughput-summary.json k6/trade-throughput.js
```

### `load-test.js`
Compatibility entrypoint that re-exports the same trade-throughput scenarios.

### `stellar-sim.js`
Simulates Stellar RPC submission behavior for account lookups, simulation, submission, and fee estimation.

## Configuration

Set environment variables to target a different backend or network:
```bash
BASE_URL=http://localhost:3001 \
STELLAR_RPC_URL=https://soroban-testnet.stellar.org \
k6 run k6/trade-throughput.js
```

### Option presets

- `smokeOptions` - lightweight smoke test
- `loadOptions` - standard load ramp
- `stressOptions` - sustained stress ramp
- `soakOptions` - long-running endurance profile
- `throughputOptions` - trade creation and settlement throughput scenarios

Sample reports are stored in `k6/reports/`.
