import React from 'react';
import { render, screen } from '@testing-library/react';
import { AuditLogCard } from '../AuditLogCard';

// Mock the BentoCard component
jest.mock('@/components/ui/BentoCard', () => ({
    BentoCard: ({ children, title, glowVariant, className }: { children: React.ReactNode, title?: string, icon?: React.ReactNode, glowVariant?: string, className?: string }) => (
        <div data-testid="bento-card" data-title={title} data-glow={glowVariant} className={className}>
            {children}
        </div>
    ),
}));

// Mock next/image
jest.mock('next/image', () => ({
    __esModule: true,
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
        /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */
        <img {...props} />
    ),
}));

describe('AuditLogCard Component', () => {
    const defaultProps = {
        entries: [
            {
                type: 'biometric' as const,
                title: 'Biometric validation passed',
                metadata: '2m ago • 192.168.1.44',
            },
            {
                type: 'multi-sig' as const,
                title: 'Multi-sig request broadcast',
                metadata: '1h ago • ID: 494022',
            },
            {
                type: 'ledger' as const,
                title: 'Ledger synchronization',
                metadata: 'Yesterday • Block 182,990',
            },
        ],
        isLiveSync: true,
    };

    it('renders without crashing with all props', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('displays the audit log title', () => {
        render(<AuditLogCard {...defaultProps} />);
        expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });

    it('displays the Live Sync indicator when isLiveSync is true', () => {
        render(<AuditLogCard {...defaultProps} isLiveSync={true} />);
        expect(screen.getByText('Live Sync')).toBeInTheDocument();
    });

    it('does not display the Live Sync indicator when isLiveSync is false', () => {
        render(<AuditLogCard {...defaultProps} isLiveSync={false} />);
        expect(screen.queryByText('Live Sync')).not.toBeInTheDocument();
    });

    it('renders all audit log entries', () => {
        render(<AuditLogCard {...defaultProps} />);
        expect(screen.getByText('Biometric validation passed')).toBeInTheDocument();
        expect(screen.getByText('Multi-sig request broadcast')).toBeInTheDocument();
        expect(screen.getByText('Ledger synchronization')).toBeInTheDocument();
    });

    it('displays metadata for each entry', () => {
        render(<AuditLogCard {...defaultProps} />);
        expect(screen.getByText('2m ago • 192.168.1.44')).toBeInTheDocument();
        expect(screen.getByText('1h ago • ID: 494022')).toBeInTheDocument();
        expect(screen.getByText('Yesterday • Block 182,990')).toBeInTheDocument();
    });

    it('renders biometric entry with correct icon', () => {
        render(<AuditLogCard {...defaultProps} />);
        const biometricEntry = screen.getByText('Biometric validation passed').closest('div');
        const svgIcon = biometricEntry?.querySelector('svg');
        expect(svgIcon).toBeInTheDocument();
    });

    it('renders multi-sig entry with correct icon', () => {
        render(<AuditLogCard {...defaultProps} />);
        const multiSigEntry = screen.getByText('Multi-sig request broadcast').closest('div');
        const imgIcon = multiSigEntry?.querySelector('img');
        expect(imgIcon).toBeInTheDocument();
    });

    it('renders ledger entry with correct icon', () => {
        render(<AuditLogCard {...defaultProps} />);
        const ledgerEntry = screen.getByText('Ledger synchronization').closest('div');
        const svgIcon = ledgerEntry?.querySelector('svg');
        expect(svgIcon).toBeInTheDocument();
    });

    it('applies correct background color for biometric entry', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const biometricBg = container.querySelector('.bg-emerald-muted');
        expect(biometricBg).toBeInTheDocument();
    });

    it('applies correct background color for multi-sig entry', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const multiSigBg = container.querySelector('.bg-gold-muted');
        expect(multiSigBg).toBeInTheDocument();
    });

    it('applies correct background color for ledger entry', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const ledgerBg = container.querySelector('.bg-bg-elevated');
        expect(ledgerBg).toBeInTheDocument();
    });

    it('renders the shield icon', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const shieldIcon = container.querySelector('svg');
        expect(shieldIcon).toBeInTheDocument();
    });

    it('handles empty entries array', () => {
        render(<AuditLogCard {...defaultProps} entries={[]} />);
        expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });

    it('handles single entry', () => {
        const singleEntry = [
            {
                type: 'biometric' as const,
                title: 'Single Entry',
                metadata: 'Just now',
            },
        ];
        render(<AuditLogCard {...defaultProps} entries={singleEntry} />);
        expect(screen.getByText('Single Entry')).toBeInTheDocument();
    });

    it('applies emerald glow variant', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveAttribute('data-glow', 'emerald');
    });

    it('applies correct styling classes to the card', () => {
        const { container } = render(<AuditLogCard {...defaultProps} />);
        const card = container.querySelector('[data-testid="bento-card"]');
        expect(card).toHaveClass('h-full');
    });

    it('renders pulse animation on Live Sync indicator', () => {
        const { container } = render(<AuditLogCard {...defaultProps} isLiveSync={true} />);
        const pulseElement = container.querySelector('.animate-pulse');
        expect(pulseElement).toBeInTheDocument();
    });

    it('handles different log types', () => {
        const differentEntries = [
            {
                type: 'biometric' as const,
                title: 'Biometric Entry',
                metadata: 'Test metadata',
            },
            {
                type: 'multi-sig' as const,
                title: 'Multi-sig Entry',
                metadata: 'Test metadata',
            },
            {
                type: 'ledger' as const,
                title: 'Ledger Entry',
                metadata: 'Test metadata',
            },
        ];
        render(<AuditLogCard {...defaultProps} entries={differentEntries} />);
        expect(screen.getByText('Biometric Entry')).toBeInTheDocument();
        expect(screen.getByText('Multi-sig Entry')).toBeInTheDocument();
        expect(screen.getByText('Ledger Entry')).toBeInTheDocument();
    });
});
