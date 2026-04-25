import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VaultValueCard } from '../VaultValueCard';

// Mock the BentoCard component
jest.mock('@/components/ui/BentoCard', () => ({
    BentoCard: ({ children, title, glowVariant, className }: { children: React.ReactNode, title?: string, icon?: React.ReactNode, glowVariant?: string, className?: string }) => (
        <div data-testid="bento-card" data-title={title} data-glow={glowVariant} className={className}>
            {children}
        </div>
    ),
}));

describe('VaultValueCard Component', () => {
    const defaultProps = {
        value: 2480000,
        currency: 'USD',
        isInsured: true,
        onReleaseFunds: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders without crashing with all props', () => {
        const { container } = render(<VaultValueCard {...defaultProps} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('displays the total vault value label', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('Total Vault Value')).toBeInTheDocument();
    });

    it('formats the vault value correctly (2,480,000 → $2,480,000)', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('$2,480,000')).toBeInTheDocument();
    });

    it('displays the currency label', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('USD')).toBeInTheDocument();
    });

    it('displays the FIAT label', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('FIAT')).toBeInTheDocument();
    });

    it('displays the decimal part (.00)', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('.00')).toBeInTheDocument();
    });

    it('displays "Fully Insured" badge when isInsured is true', () => {
        render(<VaultValueCard {...defaultProps} isInsured={true} />);
        expect(screen.getByText('Fully Insured')).toBeInTheDocument();
    });

    it('displays insurance description when isInsured is true', () => {
        render(<VaultValueCard {...defaultProps} isInsured={true} />);
        expect(screen.getByText(/Secured with multi-signature cold storage/)).toBeInTheDocument();
    });

    it('does not display insurance badge when isInsured is false', () => {
        render(<VaultValueCard {...defaultProps} isInsured={false} />);
        expect(screen.queryByText('Fully Insured')).not.toBeInTheDocument();
    });

    it('displays the Release Funds button', () => {
        render(<VaultValueCard {...defaultProps} />);
        expect(screen.getByText('Release Funds')).toBeInTheDocument();
    });

    it('calls onReleaseFunds when Release Funds button is clicked', () => {
        const onReleaseFunds = jest.fn();
        render(<VaultValueCard {...defaultProps} onReleaseFunds={onReleaseFunds} />);

        const button = screen.getByText('Release Funds');
        fireEvent.click(button);

        expect(onReleaseFunds).toHaveBeenCalledTimes(1);
    });

    it('renders the key icon in the Release Funds button', () => {
        render(<VaultValueCard {...defaultProps} />);
        const button = screen.getByText('Release Funds').closest('button');
        const svgIcon = button?.querySelector('svg');
        expect(svgIcon).toBeInTheDocument();
    });

    it('renders the shield icon in the insurance badge', () => {
        const { container } = render(<VaultValueCard {...defaultProps} isInsured={true} />);
        const shieldIcon = container.querySelector('svg');
        expect(shieldIcon).toBeInTheDocument();
    });

    it('handles different currency values', () => {
        render(<VaultValueCard {...defaultProps} currency="EUR" />);
        expect(screen.getByText('EUR')).toBeInTheDocument();
    });

    it('formats different value amounts correctly', () => {
        render(<VaultValueCard {...defaultProps} value={1000000} />);
        expect(screen.getByText('$1,000,000')).toBeInTheDocument();
    });

    it('handles zero value', () => {
        render(<VaultValueCard {...defaultProps} value={0} />);
        expect(screen.getByText('$0')).toBeInTheDocument();
    });

    it('applies correct styling classes to the card', () => {
        const { container } = render(<VaultValueCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveClass('h-full');
    });

    it('applies emerald glow variant', () => {
        const { container } = render(<VaultValueCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveAttribute('data-glow', 'emerald');
    });
});
