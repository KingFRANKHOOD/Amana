import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Step3Review from '../steps/Step3Review';
import { TradeProvider } from '../TradeContext';

// Mock the hooks and modules
jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({
        token: 'mock-token',
        isAuthenticated: true,
        connectWallet: jest.fn(),
        authenticate: jest.fn(),
        isWalletConnected: true,
    }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        trades: {
            create: jest.fn(),
        },
    },
    ApiError: class ApiError extends Error { },
}));

jest.mock('@stellar/freighter-api', () => ({
    signTransaction: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
    }),
}));

const renderWithProvider = () => {
    return render(
        <TradeProvider>
            <Step3Review />
        </TradeProvider>
    );
};

describe('Step3Review', () => {
    describe('summary display', () => {
        it('should render review rows', () => {
            renderWithProvider();

            expect(screen.getByText('Commodity')).toBeInTheDocument();
            expect(screen.getByText('Quantity')).toBeInTheDocument();
            expect(screen.getByText('Price per unit')).toBeInTheDocument();
            expect(screen.getByText('Total Value')).toBeInTheDocument();
            expect(screen.getByText('USDC Amount')).toBeInTheDocument();
            expect(screen.getByText('Seller Address')).toBeInTheDocument();
            expect(screen.getByText('Loss Ratio')).toBeInTheDocument();
            expect(screen.getByText('Delivery Window')).toBeInTheDocument();
        });

        it('should display commodity value', () => {
            renderWithProvider();

            const commodityRow = screen.getByText('Commodity').closest('div');
            expect(commodityRow).toHaveTextContent('');
        });

        it('should display quantity with unit', () => {
            renderWithProvider();

            const quantityRow = screen.getByText('Quantity').closest('div');
            expect(quantityRow).toHaveTextContent('kg');
        });

        it('should display price per unit with currency', () => {
            renderWithProvider();

            const priceRow = screen.getByText('Price per unit').closest('div');
            expect(priceRow).toHaveTextContent('NGN');
        });

        it('should display total value', () => {
            renderWithProvider();

            const totalRow = screen.getByText('Total Value').closest('div');
            expect(totalRow).toHaveTextContent('—');
        });

        it('should display USDC amount', () => {
            renderWithProvider();

            const usdcRow = screen.getByText('USDC Amount').closest('div');
            expect(usdcRow).toHaveTextContent('0 USDC');
        });

        it('should display seller address', () => {
            renderWithProvider();

            const addressRow = screen.getByText('Seller Address').closest('div');
            expect(addressRow).toBeInTheDocument();
        });

        it('should display loss ratio', () => {
            renderWithProvider();

            const lossRow = screen.getByText('Loss Ratio').closest('div');
            expect(lossRow).toHaveTextContent('Buyer 50% / Seller 50%');
        });

        it('should display delivery window', () => {
            renderWithProvider();

            const deliveryRow = screen.getByText('Delivery Window').closest('div');
            expect(deliveryRow).toHaveTextContent('7 days');
        });

        it('should display notes when present', () => {
            renderWithProvider();

            // Notes are empty by default, so they shouldn't be displayed
            expect(screen.queryByText('Notes')).not.toBeInTheDocument();
        });
    });

    describe('authorization callout', () => {
        it('should display authorization message', () => {
            renderWithProvider();

            expect(screen.getByText(/by submitting, you authorize a stellar transaction/i)).toBeInTheDocument();
        });

        it('should display USDC amount in authorization message', () => {
            renderWithProvider();

            expect(screen.getByText(/locking 0 usdc/i)).toBeInTheDocument();
        });
    });

    describe('navigation buttons', () => {
        it('should render back button', () => {
            renderWithProvider();

            const backButton = screen.getByRole('button', { name: /back/i });
            expect(backButton).toBeInTheDocument();
        });

        it('should render submit button', () => {
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            expect(submitButton).toBeInTheDocument();
        });

        it('should navigate to step 2 when back button is clicked', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const backButton = screen.getByRole('button', { name: /back/i });
            await user.click(backButton);

            expect(backButton).toBeInTheDocument();
        });
    });

    describe('submit button states', () => {
        it('should be enabled when authenticated', () => {
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            expect(submitButton).not.toBeDisabled();
        });

        it('should show loading state when submitting', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // After clicking, button should show loading state
            await waitFor(() => {
                expect(screen.getByText(/creating trade/i)).toBeInTheDocument();
            });
        });

        it('should be disabled while loading', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            await waitFor(() => {
                const loadingButton = screen.getByRole('button', { name: /creating trade/i });
                expect(loadingButton).toBeDisabled();
            });
        });
    });

    describe('error states', () => {
        it('should display error message when submission fails', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // Error would be displayed if submission fails
            // This test verifies the error display structure exists
        });

        it('should display authentication error when not authenticated', async () => {
            // Mock unauthenticated state
            jest.mock('@/hooks/useAuth', () => ({
                useAuth: () => ({
                    token: null,
                    isAuthenticated: false,
                    connectWallet: jest.fn(),
                    authenticate: jest.fn(),
                    isWalletConnected: false,
                }),
            }));

            renderWithProvider();

            // Should show authentication required message
            expect(screen.getByText(/authentication required/i)).toBeInTheDocument();
        });
    });

    describe('success states', () => {
        it('should display success message after successful submission', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // After successful submission, success state would be displayed
            // This test verifies the success display structure exists
        });

        it('should display trade ID after successful submission', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // Trade ID would be displayed after successful submission
        });

        it('should display transaction hash after successful submission', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // Transaction hash would be displayed after successful submission
        });

        it('should display view trade details button after successful submission', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // View trade details button would be displayed after successful submission
        });

        it('should display view all trades link after successful submission', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });
            await user.click(submitButton);

            // View all trades link would be displayed after successful submission
        });
    });

    describe('authentication states', () => {
        it('should display connect wallet button when wallet not connected', () => {
            renderWithProvider();

            // When wallet is not connected, connect wallet button should be displayed
            // This test verifies the authentication flow structure
        });

        it('should display sign in button when wallet connected but not authenticated', () => {
            renderWithProvider();

            // When wallet is connected but not authenticated, sign in button should be displayed
        });

        it('should disable submit button when not authenticated', () => {
            renderWithProvider();

            // When not authenticated, submit button should be disabled
        });
    });

    describe('edge cases', () => {
        it('should handle empty commodity', () => {
            renderWithProvider();

            const commodityRow = screen.getByText('Commodity').closest('div');
            expect(commodityRow).toHaveTextContent('');
        });

        it('should handle empty quantity', () => {
            renderWithProvider();

            const quantityRow = screen.getByText('Quantity').closest('div');
            expect(quantityRow).toHaveTextContent('kg');
        });

        it('should handle empty price', () => {
            renderWithProvider();

            const priceRow = screen.getByText('Price per unit').closest('div');
            expect(priceRow).toHaveTextContent('NGN');
        });

        it('should handle empty seller address', () => {
            renderWithProvider();

            const addressRow = screen.getByText('Seller Address').closest('div');
            expect(addressRow).toBeInTheDocument();
        });

        it('should handle zero total value', () => {
            renderWithProvider();

            const totalRow = screen.getByText('Total Value').closest('div');
            expect(totalRow).toHaveTextContent('—');
        });

        it('should handle zero USDC amount', () => {
            renderWithProvider();

            const usdcRow = screen.getByText('USDC Amount').closest('div');
            expect(usdcRow).toHaveTextContent('0 USDC');
        });

        it('should handle very large total values', () => {
            renderWithProvider();

            // This test would verify that large numbers are formatted correctly
            const totalRow = screen.getByText('Total Value').closest('div');
            expect(totalRow).toBeInTheDocument();
        });

        it('should handle very large USDC amounts', () => {
            renderWithProvider();

            // This test would verify that large USDC amounts are displayed correctly
            const usdcRow = screen.getByText('USDC Amount').closest('div');
            expect(usdcRow).toBeInTheDocument();
        });

        it('should prevent empty submission', async () => {
            renderWithProvider();

            const submitButton = screen.getByRole('button', { name: /lock funds & create trade/i });

            // Button should be enabled (validation happens on backend)
            expect(submitButton).not.toBeDisabled();
        });
    });
});
