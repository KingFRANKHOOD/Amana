# 🌾 Amana Mobile

This folder contains the official React Native mobile client for **Amana**, a decentralized escrow protocol designed to secure agricultural trade across different regions.

Amana eliminates the "Trust Gap" between buyers and sellers using Soroban Smart Contracts on the Stellar network, ensuring fair trade even when parties are hundreds of miles apart.

## About Amana

**Amana** provides a programmable safety net for regional commodity trading:

- **Smart Escrow**: Secure funds holding using cNGN/stablecoins on the Stellar network
- **Dynamic Loss Sharing**: Negotiable risk-sharing ratios (e.g., 50/50, 70/30) for handling transit accidents
- **Proof-of-Delivery (PoD)**: Mandatory video-based verification involving buyer and driver
- **Automated Settlement**: Flat 1% platform fee deducted upon successful trade completion
- **Volatility Protection**: Stellar Path Payments allow users to pay in local currency (NGN) while locking value in cNGN

## Mobile Features

- Wallet-based authentication via Stellar Freighter
- Secure token storage on device
- Offline-aware state management
- Mediator dispute resolution

## Tech Stack

- **Framework**: React Native with Expo
- **Language**: TypeScript
- **Navigation**: React Navigation (stack-based)
- **State Management**: Zustand for lightweight store management
- **Wallet**: Stellar Freighter integration
- **Notifications**: Expo Push Notifications / Firebase Cloud Messaging
- **Secure Storage**: Expo Secure Store for token persistence
- **Code Quality**: ESLint, Prettier, TypeScript strict mode

## Getting Started

### Prerequisites

- Node.js 20+ / npm or yarn
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (on macOS) or Android Emulator

### Install dependencies

```bash
cd mobile
npm install
```

### Environment

Copy the example env file:

```bash
cp .env.example .env.local
```

Configure for your environment:

- `EXPO_PUBLIC_API_URL` – backend API endpoint (default: http://localhost:4000)
- `EXPO_PUBLIC_STELLAR_NETWORK` – testnet or public network
- `EXPO_PUBLIC_PUSH_PROVIDER` – expo or firebase

### Run in development

```bash
npm start
```

Then select:

- `i` for iOS Simulator
- `a` for Android Emulator
- `w` for web (requires `expo-web`)

### Build for production

```bash
npm run build
```

### Type check

```bash
npm run type-check
```

### Lint

```bash
npm run lint
```

## Project structure

- `src/api/` – API client and service methods
- `src/stores/` – Zustand state management
- `src/screens/` – Screen components
- `src/App.tsx` – Root app component
- `app.config.ts` – Expo configuration

## Backend integration

This mobile client integrates with the Amana backend API described in the monorepo documentation.

## Notes

- The mobile app uses the same backend authentication and trade services as the web application.
- Payloads are optimized for low-bandwidth mobile environments.
- Secure token storage prevents credentials from being logged or exposed.
