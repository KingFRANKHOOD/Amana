import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../types/navigation';
import { useAuthStore } from '../stores/authStore';

export interface DeepLinkTarget {
  screen: keyof RootStackParamList;
  params?: Record<string, any>;
}

interface UseDeepLinkReturn {
  pendingDeepLink: DeepLinkTarget | null;
  handleDeepLink: (target: DeepLinkTarget) => void;
  navigateToDeepLink: (navigation: NavigationProp<RootStackParamList>) => void;
}

export function useDeepLink(): UseDeepLinkReturn {
  const { token } = useAuthStore();
  const pendingDeepLinkRef = useRef<DeepLinkTarget | null>(null);

  // Parse deep link URL and extract screen and params
  const parseDeepLink = useCallback((url: string): DeepLinkTarget | null => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Match trades/:id pattern
      const tradeMatch = pathname.match(/\/trades\/([^/]+)$/);
      if (tradeMatch) {
        return {
          screen: 'TradeDetail',
          params: { id: tradeMatch[1] },
        };
      }

      // Match disputes/:id pattern
      const disputeMatch = pathname.match(/\/disputes\/([^/]+)$/);
      if (disputeMatch) {
        return {
          screen: 'DisputeDetail',
          params: { id: disputeMatch[1] },
        };
      }

      // Match evidence/:tradeId pattern
      const evidenceMatch = pathname.match(/\/evidence\/([^/]+)$/);
      if (evidenceMatch) {
        return {
          screen: 'EvidenceCapture',
          params: { tradeId: evidenceMatch[1] },
        };
      }

      // Match trade list
      if (pathname === '/trades' || pathname === '/') {
        return {
          screen: 'TradeList',
        };
      }

      // Match create trade
      if (pathname === '/create-trade') {
        return {
          screen: 'CreateTrade',
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing deep link:', error);
      return null;
    }
  }, []);

  const handleDeepLink = useCallback(
    (target: DeepLinkTarget) => {
      if (!token) {
        // Store the target for navigation after authentication
        pendingDeepLinkRef.current = target;
      }
    },
    [token]
  );

  const navigateToDeepLink = useCallback(
    (navigation: NavigationProp<RootStackParamList>) => {
      const target = pendingDeepLinkRef.current;

      if (target && token) {
        // Clear the pending deep link
        pendingDeepLinkRef.current = null;

        // Navigate to the target screen
        if (target.params) {
          navigation.navigate(target.screen as never, target.params as never);
        } else {
          navigation.navigate(target.screen as never);
        }
      }
    },
    [token]
  );

  return {
    pendingDeepLink: pendingDeepLinkRef.current,
    handleDeepLink,
    navigateToDeepLink,
  };
}
