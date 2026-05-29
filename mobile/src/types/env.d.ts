declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_ANALYTICS_ENABLED?: string;
    EXPO_PUBLIC_STELLAR_NETWORK?: string;
    EXPO_PUBLIC_PUSH_PROVIDER?: string;
    [key: string]: string | undefined;
  };
};
