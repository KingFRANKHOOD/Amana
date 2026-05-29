import { ExpoConfig, getDefaultConfig } from 'expo/config';

const config: ExpoConfig = {
  ...getDefaultConfig(__dirname),
  name: 'Amana',
  slug: 'amana-mobile',
  version: '0.1.0',
  scheme: 'amana',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  entryPoint: './src/index.tsx',
  ios: {
    supportsTabletMode: true,
    bundleIdentifier: 'com.amana.mobile',
  },
  android: {
    package: 'com.amana.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
};

export default config;
