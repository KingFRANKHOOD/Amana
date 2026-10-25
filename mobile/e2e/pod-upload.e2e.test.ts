/**
 * E2E device tests for Proof-of-Delivery (PoD) evidence upload flow.
 *
 * Covers:
 *  1. Evidence type selection (video vs photo)
 *  2. Media capture simulation
 *  3. Upload to the backend API
 *  4. Success state after upload
 *
 * These tests mock expo APIs and the API client so they run on CI
 * without requiring a camera or real IPFS endpoint.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import EvidenceCaptureScreen from '../src/screens/EvidenceCaptureScreen';

jest.mock('../src/api/client', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const TRADE_ID = 'trade-pod-001';
const mockApiClient = jest.requireMock('../src/api/client').default;
type EvidenceCaptureProps = ComponentProps<typeof EvidenceCaptureScreen>;

function renderWithNavigation(params: EvidenceCaptureProps['route']['params']) {
  const props = {
    route: { key: 'EvidenceCapture', name: 'EvidenceCapture', params },
    navigation: {
      goBack: jest.fn(),
      navigate: jest.fn(),
    },
  } as unknown as EvidenceCaptureProps;

  return render(
    React.createElement(EvidenceCaptureScreen, props),
  );
}

describe('Proof-of-Delivery Evidence Upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the evidence capture screen with type selector', () => {
    const { getByText } = renderWithNavigation({ tradeId: TRADE_ID });

    expect(getByText('Upload Evidence')).toBeTruthy();
    expect(getByText(/Trade:/)).toBeTruthy();
    expect(getByText('Evidence Type')).toBeTruthy();
    expect(getByText('Video')).toBeTruthy();
    expect(getByText('Photo')).toBeTruthy();
    expect(getByText('Record Delivery Video')).toBeTruthy();
  });

  it('switches between video and photo evidence types', () => {
    const { getByText, queryByText } = renderWithNavigation({ tradeId: TRADE_ID });

    // Default is video
    expect(getByText('Record Delivery Video')).toBeTruthy();

    // Switch to photo
    fireEvent.press(getByText('Photo'));
    expect(getByText('Take Delivery Photo')).toBeTruthy();
    expect(queryByText('Record Delivery Video')).toBeNull();

    // Switch back to video
    fireEvent.press(getByText('Video'));
    expect(getByText('Record Delivery Video')).toBeTruthy();
  });

  it('shows capture area placeholder', () => {
    const { getByText } = renderWithNavigation({ tradeId: TRADE_ID });

    expect(getByText('Tap to record')).toBeTruthy();
  });

  it('uploads evidence to the API and shows success', async () => {
    mockApiClient.post.mockResolvedValueOnce({ data: { cid: 'QmTestEvidence123' } });

    const formDataFields: Record<string, unknown> = {};
    const formDataMock = {
      append: jest.fn((name: string, value: unknown) => {
        formDataFields[name] = value;
      }),
    };
    jest
      .spyOn(globalThis, 'FormData')
      .mockImplementation(() => formDataMock as unknown as FormData);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find(({ text }) => text === 'Simulate Capture')?.onPress?.();
    });

    const { getByText } = renderWithNavigation({ tradeId: TRADE_ID });

    // Simulate capture by pressing the capture area
    const captureArea = getByText('Tap to record');
    fireEvent.press(captureArea);

    expect(getByText(/Ready to upload/)).toBeTruthy();

    fireEvent.press(getByText('☁️ Upload Video'));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(getByText('Evidence Uploaded')).toBeTruthy();
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      `/trades/${TRADE_ID}/evidence`,
      formDataMock,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'multipart/form-data' }),
      }),
    );
    expect(formDataFields.tradeId).toBe(TRADE_ID);
    expect(formDataFields.mediaType).toBe('video');
    expect(formDataFields.file).toEqual(
      expect.objectContaining({
        uri: expect.stringMatching(/^file:\/\/simulated-evidence-/),
        name: expect.stringMatching(/^evidence-trade-pod-001-/),
        type: 'video/mp4',
      }),
    );
  });

  it('shows guidance text for video evidence', () => {
    const { getByText } = renderWithNavigation({ tradeId: TRADE_ID });

    expect(
      getByText(/Record a video showing the goods and their condition/),
    ).toBeTruthy();
  });

  it('shows guidance text for photo evidence', () => {
    const { getByText } = renderWithNavigation({ tradeId: TRADE_ID });

    fireEvent.press(getByText('Photo'));

    expect(
      getByText(/Take a clear photo of the goods showing any damage or discrepancy/),
    ).toBeTruthy();
  });
});
