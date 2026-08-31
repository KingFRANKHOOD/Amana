import { render, fireEvent } from '@testing-library/react-native';
import DisputeDetailScreen from '../DisputeDetailScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

describe('DisputeDetailScreen', () => {
  it('renders the dispute ID', () => {
    const { getByText } = render(
      <DisputeDetailScreen navigation={mockNavigation as any} route={{ params: { id: 'dispute-456' } } as any} />
    );
    expect(getByText('Dispute')).toBeTruthy();
    expect(getByText('dispute-456')).toBeTruthy();
  });

  it('navigates back when back is pressed', () => {
    const { getByText } = render(
      <DisputeDetailScreen navigation={mockNavigation as any} route={{ params: { id: 'dispute-456' } } as any} />
    );
    fireEvent.press(getByText('Back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
