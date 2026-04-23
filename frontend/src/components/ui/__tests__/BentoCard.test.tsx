import React from 'react';
import { render, screen } from '@testing-library/react';
import { BentoCard } from '../BentoCard';

describe('BentoCard Component', () => {
    const defaultProps = {
        title: 'Test Card',
        children: <div>Card content</div>,
    };

    it('renders without crashing with all props', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('displays the title', () => {
        render(<BentoCard {...defaultProps} />);
        expect(screen.getByText('Test Card')).toBeInTheDocument();
    });

    it('renders children content', () => {
        render(<BentoCard {...defaultProps} />);
        expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('renders the icon when provided', () => {
        const { container } = render(
            <BentoCard {...defaultProps} icon={<svg data-testid="test-icon" />} />
        );
        const icon = container.querySelector('[data-testid="test-icon"]');
        expect(icon).toBeInTheDocument();
    });

    it('does not render icon when not provided', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        const iconContainer = container.querySelector('.text-gold');
        expect(iconContainer).not.toBeInTheDocument();
    });

    it('applies gold glow variant', () => {
        const { container } = render(<BentoCard {...defaultProps} glowVariant="gold" />);
        const card = container.firstChild as HTMLElement;
        expect(card).toHaveClass('hover:shadow-glow-gold');
    });

    it('applies emerald glow variant', () => {
        const { container } = render(<BentoCard {...defaultProps} glowVariant="emerald" />);
        const card = container.firstChild as HTMLElement;
        expect(card).toHaveClass('hover:shadow-glow-emerald');
    });

    it('applies none glow variant by default', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        const card = container.firstChild as HTMLElement;
        expect(card).not.toHaveClass('hover:shadow-glow-gold');
        expect(card).not.toHaveClass('hover:shadow-glow-emerald');
    });

    it('applies custom className', () => {
        const { container } = render(<BentoCard {...defaultProps} className="custom-class" />);
        const card = container.firstChild as HTMLElement;
        expect(card).toHaveClass('custom-class');
    });

    it('applies base styling classes', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        const card = container.firstChild as HTMLElement;
        expect(card).toHaveClass(
            'bg-[#101E18F2]',
            'border',
            'border-border-default',
            'rounded-2xl',
            'p-6',
            'shadow-card',
            'hover:shadow-card-hover',
            'transition-shadow',
            'duration-300',
            'relative',
            'overflow-hidden',
            'flex',
            'flex-col'
        );
    });

    it('renders title with correct styling', () => {
        render(<BentoCard {...defaultProps} />);
        const title = screen.getByText('Test Card');
        expect(title).toHaveClass('text-lg', 'font-semibold', 'text-text-primary');
    });

    it('renders icon with correct styling', () => {
        const { container } = render(
            <BentoCard {...defaultProps} icon={<svg data-testid="test-icon" />} />
        );
        const iconContainer = container.querySelector('.text-gold');
        expect(iconContainer).toBeInTheDocument();
    });

    it('renders children in flex-1 container', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        const childrenContainer = container.querySelector('.flex-1');
        expect(childrenContainer).toBeInTheDocument();
    });

    it('handles different title values', () => {
        render(<BentoCard {...defaultProps} title="Different Title" />);
        expect(screen.getByText('Different Title')).toBeInTheDocument();
    });

    it('handles complex children', () => {
        render(
            <BentoCard {...defaultProps}>
                <div>
                    <h4>Subtitle</h4>
                    <p>Description</p>
                </div>
            </BentoCard>
        );
        expect(screen.getByText('Subtitle')).toBeInTheDocument();
        expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('passes through additional HTML attributes', () => {
        const { container } = render(
            <BentoCard {...defaultProps} data-custom="test-value" />
        );
        const card = container.firstChild as HTMLElement;
        expect(card).toHaveAttribute('data-custom', 'test-value');
    });

    it('renders with empty title', () => {
        render(<BentoCard {...defaultProps} title="" />);
        const title = screen.queryByText('Test Card');
        expect(title).not.toBeInTheDocument();
    });

    it('renders with empty children', () => {
        const { container } = render(<BentoCard {...defaultProps}>{null}</BentoCard>);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('applies correct layout structure', () => {
        const { container } = render(<BentoCard {...defaultProps} />);
        const header = container.querySelector('.flex.items-center.gap-2.mb-4');
        expect(header).toBeInTheDocument();
    });

    it('renders icon and title in same container', () => {
        const { container } = render(
            <BentoCard {...defaultProps} icon={<svg data-testid="test-icon" />} />
        );
        const header = container.querySelector('.flex.items-center.gap-2.mb-4');
        const icon = header?.querySelector('[data-testid="test-icon"]');
        const title = header?.querySelector('h3');
        expect(icon).toBeInTheDocument();
        expect(title).toBeInTheDocument();
    });
});
