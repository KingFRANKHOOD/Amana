import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisputeVerificationModal } from '../DisputeVerificationModal';
import { signTransaction } from '@stellar/freighter-api';

// Mock the VideoUploadCard component
jest.mock('@/components/ui/VideoUploadCard', () => ({
    VideoUploadCard: ({ onUpload }: { onUpload: (hash: string) => void }) => (
        <div data-testid="video-upload-card">
            <button onClick={() => onUpload('QmTestHash123')}>Upload Video</button>
        </div>
    ),
}));

// Mock Radix Dialog
jest.mock('@radix-ui/react-dialog', () => ({
    Root: ({ children, open }: { children: React.ReactNode; open: boolean; onOpenChange?: (open: boolean) => void }) => (
        <div data-testid="dialog-root" data-open={open}>
            {children}
        </div>
    ),
    Portal: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-portal">{children}</div>,
    Overlay: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="dialog-overlay" className={className}>
            {children}
        </div>
    ),
    Content: ({ children, className, ...props }: { children: React.ReactNode; className?: string; [key: string]: unknown }) => (
        <div data-testid="dialog-content" className={className} {...props}>
            {children}
        </div>
    ),
    Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <h2 data-testid="dialog-title" className={className}>
            {children}
        </h2>
    ),
    Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <p data-testid="dialog-description" className={className}>
            {children}
        </p>
    ),
    Close: ({ children, onClick, className, ...props }: { children: React.ReactNode; onClick?: () => void; className?: string; [key: string]: unknown }) => (
        <button data-testid="dialog-close" onClick={onClick} className={className} {...props}>
            {children}
        </button>
    ),
}));

// Mock Freighter API
jest.mock('@stellar/freighter-api', () => ({
    signTransaction: jest.fn(),
}));

describe('DisputeVerificationModal Component', () => {
    const defaultProps = {
        isOpen: true,
        onClose: jest.fn(),
        tradeId: 'TRADE-123',
        contractId: 'CONTRACT-456',
        walletAddress: 'GABC123...',
        releaseXdr: 'release-xdr-string',
        disputeXdr: 'dispute-xdr-string',
        networkPassphrase: 'Test SDF Network ; September 2015',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders without crashing when isOpen is true', () => {
        const { container } = render(<DisputeVerificationModal {...defaultProps} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(<DisputeVerificationModal {...defaultProps} isOpen={false} />);
        const dialogRoot = container.querySelector('[data-testid="dialog-root"]');
        expect(dialogRoot).toHaveAttribute('data-open', 'false');
    });

    it('displays the dialog title', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        expect(screen.getByText('Delivery Verification')).toBeInTheDocument();
    });

    it('displays the trade ID', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        expect(screen.getByText('TRADE-123')).toBeInTheDocument();
    });

    it('displays the contract ID', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        expect(screen.getByText('CONTRACT-456')).toBeInTheDocument();
    });

    it('renders the video upload card in upload step', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        expect(screen.getByTestId('video-upload-card')).toBeInTheDocument();
    });

    it('disables Accept Goods button when no video is uploaded', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        const acceptButton = screen.getByText('Accept Goods');
        expect(acceptButton).toBeDisabled();
    });

    it('disables Raise Dispute button when no video is uploaded', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        const disputeButton = screen.getByText('Raise Dispute');
        expect(disputeButton).toBeDisabled();
    });

    it('enables Accept Goods button after video upload', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            expect(acceptButton).not.toBeDisabled();
        });
    });

    it('enables Raise Dispute button after video upload', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const disputeButton = screen.getByText('Raise Dispute');
            expect(disputeButton).not.toBeDisabled();
        });
    });

    it('displays upload instruction when no video is uploaded', () => {
        render(<DisputeVerificationModal {...defaultProps} />);
        expect(screen.getByText('Upload video evidence before proceeding')).toBeInTheDocument();
    });

    it('moves to confirm-accept step when Accept Goods is clicked', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Confirm Goods Acceptance')).toBeInTheDocument();
        });
    });

    it('moves to confirm-dispute step when Raise Dispute is clicked', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const disputeButton = screen.getByText('Raise Dispute');
            fireEvent.click(disputeButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Confirm Dispute')).toBeInTheDocument();
        });
    });

    it('displays IPFS hash in confirm-accept step', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            expect(screen.getByText('IPFS: QmTestHash123')).toBeInTheDocument();
        });
    });

    it('displays IPFS hash in confirm-dispute step', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const disputeButton = screen.getByText('Raise Dispute');
            fireEvent.click(disputeButton);
        });

        await waitFor(() => {
            expect(screen.getByText('IPFS: QmTestHash123')).toBeInTheDocument();
        });
    });

    it('displays Back button in confirm-accept step', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Back')).toBeInTheDocument();
        });
    });

    it('returns to upload step when Back is clicked in confirm-accept', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const backButton = screen.getByText('Back');
            fireEvent.click(backButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Upload video evidence before proceeding')).toBeInTheDocument();
        });
    });

    it('displays Sign & Release Funds button in confirm-accept step', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Sign & Release Funds')).toBeInTheDocument();
        });
    });

    it('displays Sign & Raise Dispute button in confirm-dispute step', async () => {
        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const disputeButton = screen.getByText('Raise Dispute');
            fireEvent.click(disputeButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Sign & Raise Dispute')).toBeInTheDocument();
        });
    });

    it('displays signing step when transaction is being signed', async () => {
        (signTransaction as jest.Mock).mockImplementation(() => new Promise(() => { })); // Never resolves

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Waiting for Freighter wallet signature…')).toBeInTheDocument();
        });
    });

    it('displays done-accept step after successful release', async () => {
        (signTransaction as jest.Mock).mockResolvedValue({
            signedTxXdr: 'signed-xdr',
        });

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ hash: 'TX_HASH_123' }),
        });

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Funds Released')).toBeInTheDocument();
        });
    });

    it('displays done-dispute step after successful dispute', async () => {
        (signTransaction as jest.Mock).mockResolvedValue({
            signedTxXdr: 'signed-xdr',
        });

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ hash: 'TX_HASH_456' }),
        });

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const disputeButton = screen.getByText('Raise Dispute');
            fireEvent.click(disputeButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Raise Dispute');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Dispute Raised')).toBeInTheDocument();
        });
    });

    it('displays error step when signing fails', async () => {
        (signTransaction as jest.Mock).mockRejectedValue(new Error('Signing rejected'));

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
            expect(screen.getByText('Signing rejected')).toBeInTheDocument();
        });
    });

    it('displays Try Again button in error step', async () => {
        (signTransaction as jest.Mock).mockRejectedValue(new Error('Signing rejected'));

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Try Again')).toBeInTheDocument();
        });
    });

    it('returns to upload step when Try Again is clicked', async () => {
        (signTransaction as jest.Mock).mockRejectedValue(new Error('Signing rejected'));

        render(<DisputeVerificationModal {...defaultProps} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            const tryAgainButton = screen.getByText('Try Again');
            fireEvent.click(tryAgainButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Upload video evidence before proceeding')).toBeInTheDocument();
        });
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = jest.fn();
        render(<DisputeVerificationModal {...defaultProps} onClose={onClose} />);

        const closeButton = screen.getByLabelText('Close');
        fireEvent.click(closeButton);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Close button is clicked in done-accept step', async () => {
        (signTransaction as jest.Mock).mockResolvedValue({
            signedTxXdr: 'signed-xdr',
        });

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ hash: 'TX_HASH_123' }),
        });

        const onClose = jest.fn();
        render(<DisputeVerificationModal {...defaultProps} onClose={onClose} />);

        const uploadButton = screen.getByText('Upload Video');
        fireEvent.click(uploadButton);

        await waitFor(() => {
            const acceptButton = screen.getByText('Accept Goods');
            fireEvent.click(acceptButton);
        });

        await waitFor(() => {
            const signButton = screen.getByText('Sign & Release Funds');
            fireEvent.click(signButton);
        });

        await waitFor(() => {
            const closeButton = screen.getByText('Close');
            fireEvent.click(closeButton);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('locks body scroll when modal is open', () => {
        render(<DisputeVerificationModal {...defaultProps} isOpen={true} />);
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('unlocks body scroll when modal is closed', () => {
        const { rerender } = render(<DisputeVerificationModal {...defaultProps} isOpen={true} />);
        expect(document.body.style.overflow).toBe('hidden');

        rerender(<DisputeVerificationModal {...defaultProps} isOpen={false} />);
        expect(document.body.style.overflow).toBe('unset');
    });

    it('resets state when modal opens', () => {
        const { rerender } = render(<DisputeVerificationModal {...defaultProps} isOpen={false} />);

        rerender(<DisputeVerificationModal {...defaultProps} isOpen={true} />);

        expect(screen.getByText('Upload video evidence before proceeding')).toBeInTheDocument();
    });
});
