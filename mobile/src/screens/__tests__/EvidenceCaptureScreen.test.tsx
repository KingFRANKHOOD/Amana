import { render, fireEvent } from '@testing-library/react-native';
import EvidenceCaptureScreen from '../EvidenceCaptureScreen';
import { useAuthStore } from '../../stores/authStore';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

describe('EvidenceCaptureScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ token: null, walletAddress: null, isLoading: false });
  });

  it('renders the header title', () => {
    const { getByText } = render(
      <EvidenceCaptureScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('Upload Evidence')).toBeTruthy();
  });

  it('renders media type selector with video and photo', () => {
    const { getByText } = render(
      <EvidenceCaptureScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    expect(getByText('Video')).toBeTruthy();
    expect(getByText('Photo')).toBeTruthy();
  });

  it('simulates a capture', () => {
    const Alert = require('react-native').Alert;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((...args: any[]) => {
      const buttons = args[2] as any[] | undefined;
      if (buttons && buttons.length > 1 && buttons[1].onPress) {
        buttons[1].onPress();
      }
    });
    const { getByText } = render(
      <EvidenceCaptureScreen navigation={mockNavigation as any} route={{ params: { tradeId: 'trade-123' } } as any} />
    );
    fireEvent.press(getByText('Tap to record'));
    expect(getByText('Ready to upload')).toBeTruthy();
    alertSpy.mockRestore();
  });
});
