import { renderHook, act } from '@testing-library/react-native';
import { DeepLinkTarget, useDeepLink } from './useDeepLink';
import * as authStore from '../stores/authStore';

// Mock the authStore
jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

describe('useDeepLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should parse trade deep link correctly', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());

    act(() => {
      const deepLink: DeepLinkTarget = {
        screen: 'TradeDetail',
        params: { tradeId: 'trade-123' },
      };
      result.current.handleDeepLink(deepLink);
    });

    expect(result.current.pendingDeepLink).toEqual({
      screen: 'TradeDetail',
      params: { tradeId: 'trade-123' },
    });
  });

  it('should parse dispute deep link correctly', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());

    act(() => {
      const deepLink: DeepLinkTarget = {
        screen: 'DisputeDetail',
        params: { id: 'dispute-456' },
      };
      result.current.handleDeepLink(deepLink);
    });

    expect(result.current.pendingDeepLink).toEqual({
      screen: 'DisputeDetail',
      params: { id: 'dispute-456' },
    });
  });

  it('should store pending deep link when user is not authenticated', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: null,
    });

    const { result, rerender } = renderHook(() => useDeepLink());

    act(() => {
      const deepLink: DeepLinkTarget = {
        screen: 'TradeDetail',
        params: { tradeId: 'trade-789' },
      };
      result.current.handleDeepLink(deepLink);
    });

    expect(result.current.pendingDeepLink).toEqual({
      screen: 'TradeDetail',
      params: { tradeId: 'trade-789' },
    });

    // Now authenticate
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'authenticated-token',
    });

    rerender(undefined);

    // The pending deep link should still be available
    expect(result.current.pendingDeepLink).toEqual({
      screen: 'TradeDetail',
      params: { tradeId: 'trade-789' },
    });
  });

  it('should handle trade list deep link', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());

    act(() => {
      const deepLink: DeepLinkTarget = {
        screen: 'TradeList',
      };
      result.current.handleDeepLink(deepLink);
    });

    expect(result.current.pendingDeepLink).toEqual({
      screen: 'TradeList',
    });
  });

  it('should handle evidence capture deep link', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());

    act(() => {
      const deepLink: DeepLinkTarget = {
        screen: 'EvidenceCapture',
        params: { tradeId: 'trade-101' },
      };
      result.current.handleDeepLink(deepLink);
    });

    expect(result.current.pendingDeepLink).toEqual({
      screen: 'EvidenceCapture',
      params: { tradeId: 'trade-101' },
    });
  });

  it('should navigate to TradeDetail when authenticated', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());
    const navigation = { navigate: jest.fn() };

    act(() => {
      result.current.handleDeepLink({
        screen: 'TradeDetail',
        params: { tradeId: 'trade-123' },
      });
    });

    act(() => {
      result.current.navigateToDeepLink(navigation as any);
    });

    expect(navigation.navigate).toHaveBeenCalledWith('TradeDetail', { tradeId: 'trade-123' });
  });

  it('should navigate to DisputeDetail', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());
    const navigation = { navigate: jest.fn() };

    act(() => {
      result.current.handleDeepLink({
        screen: 'DisputeDetail',
        params: { id: 'dispute-1' },
      });
    });

    act(() => {
      result.current.navigateToDeepLink(navigation as any);
    });

    expect(navigation.navigate).toHaveBeenCalledWith('DisputeDetail', { id: 'dispute-1' });
  });

  it('should navigate to EvidenceCapture', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());
    const navigation = { navigate: jest.fn() };

    act(() => {
      result.current.handleDeepLink({
        screen: 'EvidenceCapture',
        params: { tradeId: 'trade-101' },
      });
    });

    act(() => {
      result.current.navigateToDeepLink(navigation as any);
    });

    expect(navigation.navigate).toHaveBeenCalledWith('EvidenceCapture', { tradeId: 'trade-101' });
  });

  it('should navigate to TradeList screen without params', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: 'test-token',
    });

    const { result } = renderHook(() => useDeepLink());
    const navigation = { navigate: jest.fn() };

    act(() => {
      result.current.handleDeepLink({ screen: 'TradeList' });
    });

    act(() => {
      result.current.navigateToDeepLink(navigation as any);
    });

    expect(navigation.navigate).toHaveBeenCalledWith('TradeList');
  });

  it('should not navigate when unauthenticated', () => {
    (authStore.useAuthStore as unknown as jest.Mock).mockReturnValue({
      token: null,
    });

    const { result } = renderHook(() => useDeepLink());
    const navigation = { navigate: jest.fn() };

    act(() => {
      result.current.handleDeepLink({ screen: 'TradeDetail', params: { tradeId: 't' } });
    });

    act(() => {
      result.current.navigateToDeepLink(navigation as any);
    });

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(result.current.pendingDeepLink).toEqual({ screen: 'TradeDetail', params: { tradeId: 't' } });
  });
});
