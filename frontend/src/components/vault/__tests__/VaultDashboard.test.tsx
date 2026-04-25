import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VaultDashboard } from '../VaultDashboard';

// Mock all child components
jest.mock('@/components/vault', () => ({
    VaultHero: ({ escrowId, custodyType, status, isSecured }: { escrowId: string, custodyType: string, status: string, isSecured: boolean }) => (
        <div data-testid="vault-hero">
            <span>{escrowId}</span>
            <span>{custodyType}</span>
            <span>{status}</span>
            <span>{isSecured ? 'Secured' : 'Not Secured'}</span>
        </div>
    ),
    ReleaseSequenceCard: ({ sequenceId, steps }: { sequenceId: string, steps: unknown[] }) => (
        <div data-testid="release-sequence-card">
            <span>{sequenceId}</span>
            <span>{steps.length} steps</span>
        </div>
    ),
    VaultValueCard: ({ value, currency, isInsured, onReleaseFunds }: { value: number, currency: string, isInsured: boolean, onReleaseFunds: () => void }) => (
        <div data-testid="vault-value-card">
            <span>{value}</span>
            <span>{currency}</span>
            <span>{isInsured ? 'Insured' : 'Not Insured'}</span>
            <button onClick={onReleaseFunds}>Release Funds</button>
        </div>
    ),
    ContractManifestCard: ({ contractId, agreementDate, settlementType, originParty, recipientParty, onExportPdf, onViewClauses }: { contractId: string, agreementDate: string, settlementType: string, originParty: { name: string }, recipientParty: { name: string }, onExportPdf: () => void, onViewClauses: () => void }) => (
        <div data-testid="contract-manifest-card">
            <span>{contractId}</span>
            <span>{agreementDate}</span>
            <span>{settlementType}</span>
            <span>{originParty.name}</span>
            <span>{recipientParty.name}</span>
            <button onClick={onExportPdf}>Export PDF</button>
            <button onClick={onViewClauses}>View Clauses</button>
        </div>
    ),
    AuditLogCard: ({ entries, isLiveSync }: { entries: unknown[], isLiveSync: boolean }) => (
        <div data-testid="audit-log-card">
            <span>{entries.length} entries</span>
            <span>{isLiveSync ? 'Live Sync' : 'Not Live'}</span>
        </div>
    ),
    NetworkBackboneCard: ({ description }: { description: string }) => (
        <div data-testid="network-backbone-card">
            <span>{description}</span>
        </div>
    ),
    VaultFooter: ({ version, links, socialLinks }: { version: string, links: unknown[], socialLinks: unknown[] }) => (
        <div data-testid="vault-footer">
            <span>{version}</span>
            <span>{links.length} links</span>
            <span>{socialLinks.length} social links</span>
        </div>
    ),
    PaymentOverviewCard: ({ totalUsdc, ngnRate }: { totalUsdc: number, ngnRate: number }) => (
        <div data-testid="payment-overview-card">
            <span>{totalUsdc}</span>
            <span>{ngnRate}</span>
        </div>
    ),
}));

describe('VaultDashboard Component', () => {
    it('renders without crashing', () => {
        const { container } = render(<VaultDashboard />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the VaultHero component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('vault-hero')).toBeInTheDocument();
    });

    it('passes correct props to VaultHero', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('8492-AX')).toBeInTheDocument();
        expect(screen.getByText('Institutional Custody')).toBeInTheDocument();
        expect(screen.getByText('Funds Locked')).toBeInTheDocument();
        expect(screen.getByText('Secured')).toBeInTheDocument();
    });

    it('renders the ReleaseSequenceCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('release-sequence-card')).toBeInTheDocument();
    });

    it('passes correct props to ReleaseSequenceCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('882-AF')).toBeInTheDocument();
        expect(screen.getByText('3 steps')).toBeInTheDocument();
    });

    it('renders the VaultValueCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('vault-value-card')).toBeInTheDocument();
    });

    it('passes correct props to VaultValueCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('2480000')).toBeInTheDocument();
        expect(screen.getByText('USD')).toBeInTheDocument();
        expect(screen.getByText('Insured')).toBeInTheDocument();
    });

    it('renders the ContractManifestCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('contract-manifest-card')).toBeInTheDocument();
    });

    it('passes correct props to ContractManifestCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('AMN-772-VLT-09')).toBeInTheDocument();
        expect(screen.getByText('September 24, 2023')).toBeInTheDocument();
        expect(screen.getByText('Immediate / Fiat-Backed')).toBeInTheDocument();
        expect(screen.getByText('Global Biotech Inc.')).toBeInTheDocument();
        expect(screen.getByText('Nova Solutions Ltd.')).toBeInTheDocument();
    });

    it('renders the AuditLogCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('audit-log-card')).toBeInTheDocument();
    });

    it('passes correct props to AuditLogCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('3 entries')).toBeInTheDocument();
        expect(screen.getByText('Live Sync')).toBeInTheDocument();
    });

    it('renders the PaymentOverviewCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('payment-overview-card')).toBeInTheDocument();
    });

    it('passes correct props to PaymentOverviewCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('2480000')).toBeInTheDocument();
        expect(screen.getByText('1580')).toBeInTheDocument();
    });

    it('renders the NetworkBackboneCard component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('network-backbone-card')).toBeInTheDocument();
    });

    it('passes correct props to NetworkBackboneCard', () => {
        render(<VaultDashboard />);
        expect(screen.getByText(/Secured and powered by the Stellar network/)).toBeInTheDocument();
    });

    it('renders the VaultFooter component', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('vault-footer')).toBeInTheDocument();
    });

    it('passes correct props to VaultFooter', () => {
        render(<VaultDashboard />);
        expect(screen.getByText('V4.8.2')).toBeInTheDocument();
        expect(screen.getByText('3 links')).toBeInTheDocument();
        expect(screen.getByText('4 social links')).toBeInTheDocument();
    });

    it('handles release funds action', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        render(<VaultDashboard />);

        const releaseButton = screen.getByText('Release Funds');
        fireEvent.click(releaseButton);

        // The handler is empty, so we just verify the button is clickable
        expect(releaseButton).toBeInTheDocument();
        consoleSpy.mockRestore();
    });

    it('handles export PDF action', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        render(<VaultDashboard />);

        const exportButton = screen.getByText('Export PDF');
        fireEvent.click(exportButton);

        // The handler is empty, so we just verify the button is clickable
        expect(exportButton).toBeInTheDocument();
        consoleSpy.mockRestore();
    });

    it('handles view clauses action', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        render(<VaultDashboard />);

        const viewClausesButton = screen.getByText('View Clauses');
        fireEvent.click(viewClausesButton);

        // The handler is empty, so we just verify the button is clickable
        expect(viewClausesButton).toBeInTheDocument();
        consoleSpy.mockRestore();
    });

    it('applies correct layout classes', () => {
        const { container } = render(<VaultDashboard />);
        const main = container.querySelector('main');
        expect(main).toHaveClass('max-w-7xl', 'mx-auto', 'px-6', 'py-10');
    });

    it('applies correct grid layout', () => {
        const { container } = render(<VaultDashboard />);
        const grid = container.querySelector('.grid');
        expect(grid).toHaveClass('grid-cols-1', 'lg:grid-cols-12', 'gap-4');
    });

    it('renders all main sections', () => {
        render(<VaultDashboard />);
        expect(screen.getByTestId('vault-hero')).toBeInTheDocument();
        expect(screen.getByTestId('release-sequence-card')).toBeInTheDocument();
        expect(screen.getByTestId('vault-value-card')).toBeInTheDocument();
        expect(screen.getByTestId('contract-manifest-card')).toBeInTheDocument();
        expect(screen.getByTestId('audit-log-card')).toBeInTheDocument();
        expect(screen.getByTestId('payment-overview-card')).toBeInTheDocument();
        expect(screen.getByTestId('network-backbone-card')).toBeInTheDocument();
        expect(screen.getByTestId('vault-footer')).toBeInTheDocument();
    });
});
