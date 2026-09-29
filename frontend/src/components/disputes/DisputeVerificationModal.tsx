import React, { useState, useCallback } from 'react';
import { X, Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import VideoUploadCard from '../ui/VideoUploadCard';

interface DisputeVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAcceptGoods: (ipfsHash: string) => void;
  onRaiseDispute: (ipfsHash: string) => void;
}

type Step = 'upload' | 'review';

export const DisputeVerificationModal: React.FC<DisputeVerificationModalProps> = ({
  isOpen,
  onClose,
  onAcceptGoods,
  onRaiseDispute,
}) => {
  const [ipfsHash, setIpfsHash] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [step, setStep] = useState<Step>('upload');
  const [submitted, setSubmitted] = useState<boolean>(false);

  const handleUploadComplete = useCallback((hash: string) => {
    setIpfsHash(hash);
    setUploading(false);
  }, []);

  const handleSubmitProof = useCallback(() => {
    if (!ipfsHash || uploading) return;
    setSubmitted(true);
    setStep('review');
  }, [ipfsHash, uploading]);

  const handleAcceptGoods = useCallback(() => {
    if (!ipfsHash) return;
    onAcceptGoods(ipfsHash);
  }, [ipfsHash, onAcceptGoods]);

  const handleRaiseDispute = useCallback(() => {
    if (!ipfsHash) return;
    onRaiseDispute(ipfsHash);
  }, [ipfsHash, onRaiseDispute]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Delivery Verification</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Upload a video of the delivered goods to verify their condition.
            </p>

            <VideoUploadCard
              onUploadComplete={handleUploadComplete}
              onSubmitProof={handleSubmitProof}
              uploading={uploading}
              ipfsHash={ipfsHash}
            />

            {submitted && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>Proof submitted. You can now accept the goods or raise a dispute.</span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleAcceptGoods}
                disabled={!ipfsHash}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept Goods
              </button>
              <button
                type="button"
                onClick={handleRaiseDispute}
                disabled={!ipfsHash}
                className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AlertTriangle className="h-4 w-4" />
                Raise Dispute
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span>Proof submitted successfully.</span>
            </div>
            <p className="break-all text-xs text-gray-500">IPFS: {ipfsHash}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleAcceptGoods}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white"
              >
                Accept Goods
              </button>
              <button
                type="button"
                onClick={handleRaiseDispute}
                className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                <AlertTriangle className="h-4 w-4" />
                Raise Dispute
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DisputeVerificationModal;
