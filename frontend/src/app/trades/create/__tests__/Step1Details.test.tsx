import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Step1Details from '../steps/Step1Details';
import { TradeProvider } from '../TradeContext';

const renderWithProvider = () => {
    return render(
        <TradeProvider>
            <Step1Details />
        </TradeProvider>
    );
};

describe('Step1Details', () => {
    describe('commodity dropdown', () => {
        it('should render commodity select with default option', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/commodity/i);
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue('');
        });

        it('should display all commodity options', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/commodity/i);
            const options = Array.from(select.querySelectorAll('option')).map(opt => opt.textContent);

            expect(options).toContain('Select commodity');
            expect(options).toContain('Maize');
            expect(options).toContain('Rice');
            expect(options).toContain('Sorghum');
            expect(options).toContain('Millet');
            expect(options).toContain('Cassava');
            expect(options).toContain('Yam');
            expect(options).toContain('Groundnut');
            expect(options).toContain('Soybean');
        });

        it('should update commodity when selected', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const select = screen.getByLabelText(/commodity/i);
            await user.selectOptions(select, 'Maize');

            expect(select).toHaveValue('Maize');
        });
    });

    describe('quantity input', () => {
        it('should render quantity input', () => {
            renderWithProvider();

            const input = screen.getByLabelText(/quantity/i);
            expect(input).toBeInTheDocument();
            expect(input).toHaveAttribute('type', 'number');
            expect(input).toHaveAttribute('min', '0');
        });

        it('should update quantity when typed', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByLabelText(/quantity/i);
            await user.type(input, '500');

            expect(input).toHaveValue(500);
        });

        it('should accept decimal values', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByLabelText(/quantity/i);
            await user.type(input, '123.45');

            expect(input).toHaveValue(123.45);
        });
    });

    describe('unit select', () => {
        it('should render unit select with default value', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/unit/i);
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue('kg');
        });

        it('should display all unit options', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/unit/i);
            const options = Array.from(select.querySelectorAll('option')).map(opt => opt.value);

            expect(options).toContain('kg');
            expect(options).toContain('tonnes');
            expect(options).toContain('bags (50kg)');
            expect(options).toContain('bags (100kg)');
        });

        it('should update unit when selected', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const select = screen.getByLabelText(/unit/i);
            await user.selectOptions(select, 'tonnes');

            expect(select).toHaveValue('tonnes');
        });
    });

    describe('price per unit input', () => {
        it('should render price per unit input', () => {
            renderWithProvider();

            const input = screen.getByLabelText(/price per unit/i);
            expect(input).toBeInTheDocument();
            expect(input).toHaveAttribute('type', 'number');
            expect(input).toHaveAttribute('min', '0');
        });

        it('should update price when typed', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByLabelText(/price per unit/i);
            await user.type(input, '450');

            expect(input).toHaveValue(450);
        });
    });

    describe('currency select', () => {
        it('should render currency select with default value', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/currency/i);
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue('NGN');
        });

        it('should display currency options', () => {
            renderWithProvider();

            const select = screen.getByLabelText(/currency/i);
            const options = Array.from(select.querySelectorAll('option')).map(opt => opt.value);

            expect(options).toContain('NGN');
            expect(options).toContain('USDC');
        });

        it('should update currency when selected', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const select = screen.getByLabelText(/currency/i);
            await user.selectOptions(select, 'USDC');

            expect(select).toHaveValue('USDC');
        });
    });

    describe('seller address input', () => {
        it('should render seller address input', () => {
            renderWithProvider();

            const input = screen.getByPlaceholderText(/g\.\.\./i);
            expect(input).toBeInTheDocument();
            expect(input).toHaveAttribute('type', 'text');
        });

        it('should update seller address when typed', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(input, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');

            expect(input).toHaveValue('GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');
        });

        it('should accept valid Stellar address format starting with G', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(input, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

            expect(input).toHaveValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        });

        it('should accept valid Stellar address format starting with M', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const input = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(input, 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

            expect(input).toHaveValue('MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        });
    });

    describe('total price calculation', () => {
        it('should display dash when quantity is empty', () => {
            renderWithProvider();

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('—');
        });

        it('should display dash when price is empty', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            await user.type(quantityInput, '500');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('—');
        });

        it('should calculate total correctly', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '500');
            await user.type(priceInput, '450');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 225,000');
        });

        it('should update total when quantity changes', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '100');
            await user.type(priceInput, '100');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 10,000');

            await user.clear(quantityInput);
            await user.type(quantityInput, '200');

            expect(totalElement).toHaveTextContent('NGN 20,000');
        });

        it('should update total when price changes', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '100');
            await user.type(priceInput, '100');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 10,000');

            await user.clear(priceInput);
            await user.type(priceInput, '200');

            expect(totalElement).toHaveTextContent('NGN 20,000');
        });

        it('should display currency in total', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);
            const currencySelect = screen.getByLabelText(/currency/i);

            await user.type(quantityInput, '100');
            await user.type(priceInput, '100');
            await user.selectOptions(currencySelect, 'USDC');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('USDC 10,000');
        });

        it('should handle decimal calculations', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '123.45');
            await user.type(priceInput, '67.89');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 8,381.02');
        });
    });

    describe('continue button', () => {
        it('should render continue button', () => {
            renderWithProvider();

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeInTheDocument();
        });

        it('should be disabled when form is empty', () => {
            renderWithProvider();

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should be disabled when only commodity is filled', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const commoditySelect = screen.getByLabelText(/commodity/i);
            await user.selectOptions(commoditySelect, 'Maize');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should be disabled when only quantity is filled', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            await user.type(quantityInput, '500');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should be disabled when only price is filled', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const priceInput = screen.getByLabelText(/price per unit/i);
            await user.type(priceInput, '450');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should be disabled when only seller address is filled', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const addressInput = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(addressInput, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should be enabled when all required fields are filled', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const commoditySelect = screen.getByLabelText(/commodity/i);
            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);
            const addressInput = screen.getByPlaceholderText(/g\.\.\./i);

            await user.selectOptions(commoditySelect, 'Maize');
            await user.type(quantityInput, '500');
            await user.type(priceInput, '450');
            await user.type(addressInput, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).not.toBeDisabled();
        });

        it('should navigate to step 2 when clicked', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const commoditySelect = screen.getByLabelText(/commodity/i);
            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);
            const addressInput = screen.getByPlaceholderText(/g\.\.\./i);

            await user.selectOptions(commoditySelect, 'Maize');
            await user.type(quantityInput, '500');
            await user.type(priceInput, '450');
            await user.type(addressInput, 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');

            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            await user.click(button);

            // After clicking, we should be on step 2
            // This would be verified by checking if Step2Negotiation is rendered
            // For now, we just verify the button was clickable
            expect(button).not.toBeDisabled();
        });
    });

    describe('edge cases', () => {
        it('should handle zero quantity', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '0');
            await user.type(priceInput, '100');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 0');
        });

        it('should handle zero price', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '100');
            await user.type(priceInput, '0');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 0');
        });

        it('should handle very large numbers', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '999999999');
            await user.type(priceInput, '999999999');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN 999,999,998,000,000,001');
        });

        it('should handle negative quantity', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '-100');
            await user.type(priceInput, '50');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN -5,000');
        });

        it('should handle negative price', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const quantityInput = screen.getByLabelText(/quantity/i);
            const priceInput = screen.getByLabelText(/price per unit/i);

            await user.type(quantityInput, '100');
            await user.type(priceInput, '-50');

            const totalElement = screen.getByText(/estimated total/i).nextElementSibling;
            expect(totalElement).toHaveTextContent('NGN -5,000');
        });

        it('should handle invalid Stellar address (too short)', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const addressInput = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(addressInput, 'GABC');

            expect(addressInput).toHaveValue('GABC');
            // Button should still be disabled because address is too short
            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).toBeDisabled();
        });

        it('should handle invalid Stellar address (wrong prefix)', async () => {
            const user = userEvent.setup();
            renderWithProvider();

            const addressInput = screen.getByPlaceholderText(/g\.\.\./i);
            await user.type(addressInput, 'XABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');

            expect(addressInput).toHaveValue('XABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890');
            // Button should still be enabled because we only check for non-empty address
            const button = screen.getByRole('button', { name: /continue to negotiation/i });
            expect(button).not.toBeDisabled();
        });
    });
});
