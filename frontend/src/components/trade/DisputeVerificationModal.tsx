"use client";

import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  CheckCircle,
  X,
  Upload,
  ExternalLink,
} from "lucide-react";
import { signTransaction } from "@stellar/freighter-api";
import { VideoUploadCard } from "@/components/ui/VideoUploadCard";

export interface DisputeVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tradeId: string;
  contractId: string;
  walletAddress: string;
  /** XDR envelope of the release() transaction to be signed on "Accept Goods" */
  releaseXdr: string;
  /** XDR envelope of the raise_dispute() transaction to be signed on "Raise Dispute" */
  disputeXdr: string;
  networkPassphrase?: string;
}

type Step =
  | "upload"
  | "confirm-accept"
  | "confirm-dispute"
  | "signing"
  | "done-accept"
  | "done-dispute"
  | "error";

export function DisputeVerificationModal({
  isOpen,
  onClose,
  tradeId,
  contractId,
  walletAddress,
  releaseXdr,
  disputeXdr,
  networkPassphrase = "Test SDF Network ; September 2015",
}: DisputeVerificationModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep("upload");
      setIpfsHash(null);
      setTxHash(null);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  const signAndSubmit = async (xdr: string, actionLabel: string) => {
    setStep("signing");
    setErrorMsg(null);

    try {
      const result = await signTransaction(xdr, {
        networkPassphrase,
        address: walletAddress,
      });

      if (result.error) {
        throw new Error(result.error.message ?? "Signing rejected");
      }

      // Submit signed XDR to Horizon
      const horizonUrl = networkPassphrase.includes("Test")
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tx: result.signedTxXdr }),
      });

      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(
          body?.extras?.result_codes?.transaction ??
            "Transaction submission failed",
        );
      }

      const data = await submitRes.json();
      setTxHash(data.hash ?? null);
      setStep(actionLabel === "release" ? "done-accept" : "done-dispute");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  const handleAcceptGoods = () => {
    setStep("confirm-accept");
  };

  const handleRaiseDispute = () => {
    setStep("confirm-dispute");
  };

  const handleConfirmAccept = () => {
    void signAndSubmit(releaseXdr, "release");
  };

  const handleConfirmDispute = () => {
    void signAndSubmit(disputeXdr, "dispute");
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-overlay backdrop-blur-lg z-50 flex items-center justify-center p-4">
          <Dialog.Content
            className="bg-[#122A1F] border border-border-default shadow-modal rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col"
            aria-describedby="dispute-modal-description"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
              <Dialog.Title className="text-lg font-semibold text-text-primary">
                Delivery Verification
              </Dialog.Title>
              <Dialog.Close
                onClick={onClose}
                className="text-text-muted hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div
              id="dispute-modal-description"
              className="px-6 py-6 flex flex-col gap-6"
            >
              {/* Trade context */}
              <div className="bg-bg-elevated rounded-xl px-4 py-3 flex flex-col gap-1">
                <p className="text-xs text-text-muted">Trade ID</p>
                <p className="text-sm font-mono text-text-primary truncate">
                  {tradeId}
                </p>
                <p className="text-xs text-text-muted mt-1">Contract</p>
                <p className="text-sm font-mono text-text-secondary truncate">
                  {contractId}
                </p>
              </div>

              {/* Step: Upload */}
              {step === "upload" && (
                <>
                  <VideoUploadCard onUpload={(hash) => setIpfsHash(hash)} />

                  <div className="flex gap-3">
                    <button
                      onClick={handleAcceptGoods}
                      disabled={!ipfsHash}
                      className="
                        flex-1 py-3 rounded-xl text-sm font-semibold
                        bg-gold text-text-inverse
                        hover:bg-gold-hover
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors duration-200 flex items-center justify-center gap-2
                      "
                    >
                      <CheckCircle className="w-4 h-4" />
                      Accept Goods
                    </button>
                    <button
                      onClick={handleRaiseDispute}
                      disabled={!ipfsHash}
                      className="
                        flex-1 py-3 rounded-xl text-sm font-semibold
                        border border-status-danger text-status-danger
                        hover:bg-status-danger hover:text-white
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors duration-200 flex items-center justify-center gap-2
                      "
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Raise Dispute
                    </button>
                  </div>

                  {!ipfsHash && (
                    <p className="text-xs text-text-muted text-center flex items-center justify-center gap-1">
                      <Upload className="w-3 h-3" />
                      Upload video evidence before proceeding
                    </p>
                  )}
                </>
              )}

              {/* Step: Confirm Accept */}
              {step === "confirm-accept" && (
                <div className="flex flex-col gap-5">
                  <div className="bg-gold-muted border border-[rgba(212,168,83,0.3)] rounded-xl p-4 text-sm text-text-primary">
                    <p className="font-semibold mb-1 text-gold">
                      Confirm Goods Acceptance
                    </p>
                    <p className="text-text-secondary">
                      Signing this transaction will call{" "}
                      <code className="font-mono text-gold">release()</code> on
                      the Amana escrow contract, releasing locked funds to the
                      seller. This action is <strong>irreversible</strong>.
                    </p>
                  </div>
                  {ipfsHash && (
                    <div className="text-xs text-text-muted bg-bg-elevated rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="truncate flex-1 font-mono">
                        IPFS: {ipfsHash}
                      </span>
                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${ipfsHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep("upload")}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border-default text-text-secondary hover:bg-bg-elevated transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleConfirmAccept}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold bg-gold text-text-inverse hover:bg-gold-hover transition-colors"
                    >
                      Sign &amp; Release Funds
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Confirm Dispute */}
              {step === "confirm-dispute" && (
                <div className="flex flex-col gap-5">
                  <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-xl p-4 text-sm text-text-primary">
                    <p className="font-semibold mb-1 text-status-danger">
                      Confirm Dispute
                    </p>
                    <p className="text-text-secondary">
                      Signing this transaction will call{" "}
                      <code className="font-mono text-status-danger">
                        raise_dispute()
                      </code>
                      , routing the trade to a mediator. Funds remain locked
                      until resolution.
                    </p>
                  </div>
                  {ipfsHash && (
                    <div className="text-xs text-text-muted bg-bg-elevated rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="truncate flex-1 font-mono">
                        IPFS: {ipfsHash}
                      </span>
                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${ipfsHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep("upload")}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border-default text-text-secondary hover:bg-bg-elevated transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleConfirmDispute}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold bg-status-danger text-white hover:opacity-90 transition-opacity"
                    >
                      Sign &amp; Raise Dispute
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Signing */}
              {step === "signing" && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  <p className="text-text-secondary text-sm text-center">
                    Waiting for Freighter wallet signature…
                  </p>
                </div>
              )}

              {/* Step: Done Accept */}
              {step === "done-accept" && (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <CheckCircle className="w-12 h-12 text-emerald" />
                  <p className="text-lg font-semibold text-text-primary">
                    Funds Released
                  </p>
                  <p className="text-sm text-text-secondary">
                    The escrow has been settled and funds released to the
                    seller.
                  </p>
                  {txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gold hover:text-gold-hover transition-colors"
                    >
                      View transaction <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button
                    onClick={onClose}
                    className="mt-2 px-6 py-2 rounded-xl bg-gold text-text-inverse text-sm font-semibold hover:bg-gold-hover transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Step: Done Dispute */}
              {step === "done-dispute" && (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <AlertTriangle className="w-12 h-12 text-status-warning" />
                  <p className="text-lg font-semibold text-text-primary">
                    Dispute Raised
                  </p>
                  <p className="text-sm text-text-secondary">
                    A mediator has been alerted. Funds remain locked pending
                    resolution.
                  </p>
                  {txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gold hover:text-gold-hover transition-colors"
                    >
                      View transaction <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button
                    onClick={onClose}
                    className="mt-2 px-6 py-2 rounded-xl border border-border-default text-text-secondary text-sm font-semibold hover:bg-bg-elevated transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Step: Error */}
              {step === "error" && (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <X className="w-12 h-12 text-status-danger" />
                  <p className="text-lg font-semibold text-text-primary">
                    Transaction Failed
                  </p>
                  {errorMsg && (
                    <p className="text-sm text-status-danger bg-[rgba(239,68,68,0.1)] rounded-lg px-4 py-2">
                      {errorMsg}
                    </p>
                  )}
                  <button
                    onClick={() => setStep("upload")}
                    className="mt-2 px-6 py-2 rounded-xl border border-border-default text-text-secondary text-sm font-semibold hover:bg-bg-elevated transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DisputeVerificationModal;
