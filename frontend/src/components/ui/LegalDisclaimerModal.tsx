"use client";

import React, { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { clsx } from "clsx";

interface LegalDisclaimerModalProps {
    isOpen: boolean;
    onAccept: () => void;
    onDecline: () => void;
    lossRatio: { buyer: number; seller: number };
    tradeValueUsdc: string;
}

export function LegalDisclaimerModal({
    isOpen,
    onAccept,
    onDecline,
    lossRatio,
    tradeValueUsdc,
}: LegalDisclaimerModalProps) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    const buyerPercentage = lossRatio.buyer / 100;
    const sellerPercentage = lossRatio.seller / 100;

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onDecline()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-overlay backdrop-blur-lg z-50 flex items-center justify-center">
                    <Dialog.Content className="bg-card border border-border-default shadow-modal max-w-lg w-full max-h-[90vh] rounded-2xl flex flex-col">
                        <div className="p-6 border-b border-border-default">
                            <Dialog.Title className="text-xl font-semibold text-primary">
                                Loss-Sharing Terms
                            </Dialog.Title>
                            <Dialog.Description className="text-sm text-secondary mt-1">
                                Please review the loss-sharing agreement before proceeding.
                            </Dialog.Description>
                        </div>

                        <div className="overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 flex-1">
                            <div className="space-y-4">
                                <p className="text-secondary text-sm">
                                    By locking funds in this escrow, you acknowledge and agree to the following loss-sharing terms in case of damage or interception during transit:
                                </p>

                                <div className="bg-gold-muted/30 text-gold p-4 rounded-lg font-medium border border-gold/20">
                                    <p className="text-sm mb-2">Loss Allocation:</p>
                                    <div className="flex justify-between items-center">
                                        <span>Buyer bears:</span>
                                        <span className="font-bold">{(buyerPercentage * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <span>Seller bears:</span>
                                        <span className="font-bold">{(sellerPercentage * 100).toFixed(0)}%</span>
                                    </div>
                                </div>

                                <div className="text-xs text-muted space-y-2">
                                    <p>
                                        <strong>Trade Value:</strong> {tradeValueUsdc} USDC
                                    </p>
                                    <p>
                                        In the event of loss or damage during transit, the locked funds will be distributed according to the ratios above. The buyer will receive {(buyerPercentage * parseFloat(tradeValueUsdc || "0")).toFixed(2)} USDC and the seller will receive {(sellerPercentage * parseFloat(tradeValueUsdc || "0")).toFixed(2)} USDC after applicable fees.
                                    </p>
                                    <p>
                                        This agreement is final and cannot be modified after the trade is created.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-border-default flex gap-3">
                            <button
                                onClick={onDecline}
                                className="flex-1 px-4 py-2 rounded-lg border border-border-default text-secondary hover:bg-elevated transition-colors"
                            >
                                Decline
                            </button>
                            <button
                                onClick={onAccept}
                                className="flex-1 px-4 py-2 rounded-lg bg-gold text-text-inverse font-medium hover:bg-gold-hover transition-colors"
                            >
                                Accept & Proceed
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}