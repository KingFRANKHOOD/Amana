# 🌾 Amana Frontend

The official Next.js web application for **Amana**, a decentralized escrow protocol designed to secure agricultural trade across different regions.

Amana eliminates the "Trust Gap" between buyers and sellers using Soroban Smart Contracts on the Stellar network, ensuring fair trade even when parties are hundreds of miles apart.

## About Amana

**Amana** provides a programmable safety net for regional commodity trading:

- **Smart Escrow**: Secure funds holding using cNGN/stablecoins on the Stellar network
- **Dynamic Loss Sharing**: Negotiable risk-sharing ratios (e.g., 50/50, 70/30) for handling transit accidents
- **Proof-of-Delivery (PoD)**: Mandatory video-based verification involving buyer and driver
- **Automated Settlement**: Flat 1% platform fee deducted upon successful trade completion
- **Volatility Protection**: Stellar Path Payments allow users to pay in local currency (NGN) while locking value in cNGN

## Frontend Responsibilities

This folder is the user-facing interface for buyers, sellers, and mediators interacting with the Amana escrow protocol.

## Features

- Next.js 16 App Router
- React 19 UI components
- Tailwind CSS styling
- Playwright visual regression testing
- Jest unit/integration testing
- Stellar wallet integration via Freighter
- Privacy-first analytics instrumentation

## Getting Started

### Prerequisites

- Node.js 20+ / npm
- A `.env.local` file configured for the frontend environment

### Install dependencies

```bash
cd frontend
npm install
```

### Environment

Copy the example env file and configure your runtime variables:

```bash
cp .env.example .env.local
```

### Run in development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
```

### Start production server

```bash
npm run start
```

### Linting

```bash
npm run lint
```

### Tests

```bash
npm test
npm run test:coverage
npm run test:visual
```

### Visual regression tests

```bash
npm run test:visual
npm run test:visual:update
```

## Notes

- `app/` contains the Next.js application and page routing.
- `src/` contains shared components, hooks, and utilities.
- `public/` holds static assets and images.
- `playwright.config.ts` controls Playwright visual regression.

## Repository Scope

This frontend lives inside the `frontend/` folder of the Amana monorepo. It serves as the UI for buyers, sellers, and mediators interacting with the backend API.

If you are consuming the backend API, point the frontend environment configuration to the correct backend endpoint.
