"use client";

import { useMemo, useState } from "react";
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { Badge } from "@/components/ui/Badge";
import { WalletAddressBadge } from "@/components/ui/WalletAddressBadge";

type Props = { disputeId: string };

type ConfirmationModalState = {
  isOpen: boolean;
  sellerGetsBps: number | null;
  splitLabel: string;
};

type VideoLoadState = "loading" | "ready" | "terminal-failure";

const DEFAULT_MEDIATOR_ADDRESSES = ["GEXAMPLEMEDIATORPUBLICKEY1"];

const PINATA_GATEWAYS = [
  process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL?.trim(),
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
].filter((value): value is string => Boolean(value));

const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;
const isDev = process.env.NEXT_PUBLIC_APP_ENV === "development";

export default function MediatorPanelClient({ disputeId }: Props) {
  const { address, isAuthorized, isLoading, connectWallet } =
    useFreighterIdentity();
  const [txStatus, setTxStatus] = useState<string>("");
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);
  const [activeGatewayIndex, setActiveGatewayIndex] = useState(0);
  const [videoLoadState, setVideoLoadState] = useState<VideoLoadState>("loading");
  const [modal, setModal] = useState<ConfirmationModalState>({
    isOpen: false,
    sellerGetsBps: null,
    splitLabel: "",
  });

  const [execString, setExecString] = useState<string>("");

  const mediatorAddresses = useMemo(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_MEDIATOR_WALLETS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    return fromEnv.length > 0 ? fromEnv : DEFAULT_MEDIATOR_ADDRESSES;
  }, []);

  const isMediator = Boolean(address && mediatorAddresses.includes(address));
  const explorerNetwork =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";

  const cid = disputeId || "QmExampleCidForDemo";
  const pinataUrl = `${PINATA_GATEWAYS[activeGatewayIndex]}/${cid}`;

  function handleVideoError() {
    const nextIndex = activeGatewayIndex + 1;
    if (nextIndex < PINATA_GATEWAYS.length) {
      setActiveGatewayIndex(nextIndex);
      setVideoLoadState("loading");
    } else {
      setVideoLoadState("terminal-failure");
    }
  }

  function switchGateway() {
    const nextIndex = (activeGatewayIndex + 1) % PINATA_GATEWAYS.length;
    setActiveGatewayIndex(nextIndex);
    setVideoLoadState("loading");
  }

  function buildExec(split: string) {
    const s = `soroban://execute?cmd=resolve_dispute&split=${split}&dispute=${disputeId}`;
    setExecString(s);
  }

  function openConfirmationModal(sellerGetsBps: number, splitLabel: string) {
    setModal({ isOpen: true, sellerGetsBps, splitLabel });
  }

  function closeModal() {
    setModal({ isOpen: false, sellerGetsBps: null, splitLabel: "" });
  }

  function getBuyerSplit(sellerBps: number): number {
    return 10000 - sellerBps;
  }

  async function executeResolution(sellerGetsBps: number) {
    if (!address) {
      setTxStatus("Connect Freighter first.");
      return;
    }

    const parsedTradeId = Number(disputeId);
    if (!Number.isInteger(parsedTradeId) || parsedTradeId < 0) {
      setTxStatus("Dispute ID must be a numeric on-chain trade_id.");
      return;
    }

    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL?.trim();

    if (!contractId || !rpcUrl) {
      setTxStatus("Missing NEXT_PUBLIC_CONTRACT_ID or NEXT_PUBLIC_RPC_URL.");
      return;
    }

    setIsSubmittingTx(true);
    setTxStatus("Preparing Soroban transaction...");

    try {
      const networkPassphrase =
        process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public"
          ? Networks.PUBLIC
          : DEFAULT_NETWORK_PASSPHRASE;

      const rpcServer = new rpc.Server(rpcUrl);
      const source = await rpcServer.getAccount(address);
      const contract = new Contract(contractId);

      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          contract.call(
            "resolve_dispute",
            nativeToScVal(BigInt(parsedTradeId), { type: "u64" }),
            Address.fromString(address).toScVal(),
            nativeToScVal(sellerGetsBps, { type: "u32" }),
          ),
        )
        .setTimeout(180)
        .build();

      const prepared = await rpcServer.prepareTransaction(tx);
      const signResult = await signTransaction(prepared.toXDR(), {
        networkPassphrase,
        address,
      });

      if (signResult.error) {
        throw new Error(signResult.error.message ?? "Freighter signing failed");
      }

      const signedTx = TransactionBuilder.fromXDR(
        signResult.signedTxXdr,
        networkPassphrase,
      );

      const sendResponse = await rpcServer.sendTransaction(signedTx);
      if (sendResponse.status === "ERROR") {
        throw new Error(
          typeof sendResponse.errorResult === "string"
            ? sendResponse.errorResult
            : JSON.stringify(
                sendResponse.errorResult ?? "Transaction rejected by RPC",
              ),
        );
      }

      setTxStatus(`Submitted. Hash: ${sendResponse.hash}`);
    } catch (error) {
      setTxStatus(
        error instanceof Error ? error.message : "Soroban execution failed",
      );
    } finally {
      setIsSubmittingTx(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Mediator Panel</h1>
        <p className="text-text-secondary mt-1">
          Dispute{" "}
          <span className="font-mono text-text-primary">{disputeId}</span>{" "}
          — Review evidence and resolve on-chain.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Evidence Video */}
        <div className="lg:col-span-7">
          <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-card">
            {videoLoadState === "terminal-failure" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6">
                <svg
                  className="w-10 h-10 text-status-danger"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-white font-medium">Evidence unavailable</p>
                <p className="text-gray-400 text-sm">
                  All IPFS gateways failed to load this file.
                </p>
                <button
                  onClick={() => {
                    setActiveGatewayIndex(0);
                    setVideoLoadState("loading");
                  }}
                  className="mt-2 px-4 py-2 bg-bg-elevated border border-border-default text-text-primary text-sm rounded-md hover:bg-bg-input transition-colors"
                >
                  Retry from first gateway
                </button>
              </div>
            ) : (
              <>
                {videoLoadState === "loading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin w-8 h-8 border-2 border-gold border-t-transparent rounded-full" />
                      <span className="text-gray-300 text-xs">
                        Loading via gateway {activeGatewayIndex + 1}/
                        {PINATA_GATEWAYS.length}…
                      </span>
                    </div>
                  </div>
                )}
                <video
                  key={pinataUrl}
                  controls
                  className="w-full h-full object-contain bg-black"
                  src={pinataUrl}
                  onLoadStart={() => setVideoLoadState("loading")}
                  onCanPlay={() => setVideoLoadState("ready")}
                  onError={handleVideoError}
                />
              </>
            )}
          </div>

          {/* Video meta */}
          <div className="mt-3 text-sm text-text-secondary space-y-2">
            <div>
              Dispute ID:{" "}
              <span className="font-mono text-text-primary">{disputeId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {videoLoadState !== "terminal-failure" && (
                <span className="text-xs text-text-muted">
                  Gateway {activeGatewayIndex + 1}/{PINATA_GATEWAYS.length}
                </span>
              )}
              {PINATA_GATEWAYS.length > 1 &&
                videoLoadState !== "terminal-failure" && (
                  <button
                    onClick={switchGateway}
                    className="text-xs text-gold hover:underline underline-offset-2"
                  >
                    Switch gateway
                  </button>
                )}
              {isMediator ? (
                <Badge variant="success">Authorized Mediator</Badge>
              ) : (
                <Badge variant="danger">Unauthorized</Badge>
              )}
            </div>
          </div>

          {/* Dev-only: IPFS debug info */}
          {isDev && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs space-y-1">
              <div className="font-semibold text-yellow-700">DEV</div>
              <div>Pinata CID: {cid}</div>
              <div>
                Gateway:{" "}
                <Badge variant="info">{PINATA_GATEWAYS[activeGatewayIndex]}</Badge>
              </div>
              <div>Wallet: {address ?? "Not connected"}</div>
            </div>
          )}
        </div>

        {/* Right: Resolution Panel */}
        <div className="lg:col-span-5">
          <div className="bg-bg-card rounded-xl shadow-card p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                Resolve Dispute
              </h3>
              <p className="text-sm text-text-secondary mt-1">
                Select a loss-ratio split to settle this trade on-chain.
              </p>
            </div>

            <div className="rounded-md border border-border-default bg-bg-elevated p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Connected wallet
              </p>
              {address ? (
                <WalletAddressBadge
                  address={address}
                  truncate="middle"
                  showCopy
                  showExplorer
                  explorerNetwork={explorerNetwork}
                />
              ) : (
                <p className="text-sm text-text-muted">No wallet connected.</p>
              )}
            </div>

            {!isAuthorized && (
              <button
                onClick={() => void connectWallet()}
                disabled={isLoading}
                className="w-full rounded-md bg-gold text-text-inverse py-2.5 text-sm font-medium hover:bg-gold-hover transition-colors disabled:opacity-50"
              >
                {isLoading ? "Connecting..." : "Connect Freighter"}
              </button>
            )}

            {isAuthorized && !isMediator && (
              <Badge variant="danger">
                Unauthorized wallet. Access is restricted to mediator addresses.
              </Badge>
            )}

            {/* Primary actions */}
            <div className="grid grid-cols-1 gap-3">
              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => openConfirmationModal(5000, "50/50")}
                className="w-full rounded-md bg-emerald-700 text-white px-3 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-emerald-800 transition"
              >
                Resolve — Equal Split (50/50)
              </button>

              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => openConfirmationModal(7000, "70/30")}
                className="w-full rounded-md bg-emerald-700 text-white px-3 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-emerald-800 transition"
              >
                Resolve — Seller Favoured (70/30)
              </button>
            </div>

            {/* Tx status feedback */}
            {txStatus && (
              <p className="text-xs text-text-secondary break-all">{txStatus}</p>
            )}

            {/* Dev-only: exec string builder */}
            {isDev && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded space-y-2">
                <p className="text-xs font-semibold text-yellow-700">
                  DEV — Exec String Builder
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={!isMediator}
                    onClick={() => buildExec("50-50")}
                    className="flex-1 rounded border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Build 50/50
                  </button>
                  <button
                    disabled={!isMediator}
                    onClick={() => buildExec("70-30")}
                    className="flex-1 rounded border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Build 70/30
                  </button>
                </div>
                <textarea
                  readOnly
                  value={execString}
                  className="block w-full rounded border-gray-200 h-16 p-2 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    disabled={!execString}
                    onClick={() => navigator.clipboard?.writeText(execString)}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
                  >
                    Copy
                  </button>
                  <a
                    href={execString || "#"}
                    onClick={(e) => {
                      if (!execString) e.preventDefault();
                    }}
                    className="px-2 py-1 bg-gray-100 rounded text-xs"
                  >
                    Preview
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {modal.isOpen && modal.sellerGetsBps !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-bg-card rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
            <h2 className="text-xl font-bold text-text-primary">
              Confirm Resolution
            </h2>

            <div className="border border-border-default rounded-lg bg-bg-elevated p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-text-secondary">
                  Trade ID:
                </span>
                <span className="text-sm font-mono text-text-primary">
                  {disputeId}
                </span>
              </div>
              <div className="border-t border-border-default" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-text-secondary">
                  Split:
                </span>
                <span className="text-sm font-semibold text-text-primary">
                  {modal.splitLabel}
                </span>
              </div>
              <div className="border-t border-border-default" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-text-secondary">
                  Seller Receives:
                </span>
                <span className="text-sm font-semibold text-status-success">
                  {(modal.sellerGetsBps / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-text-secondary">
                  Buyer Receives:
                </span>
                <span className="text-sm font-semibold text-gold">
                  {(getBuyerSplit(modal.sellerGetsBps) / 100).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
              <p className="text-xs text-yellow-800">
                <span className="font-semibold">Warning:</span> This action is
                irreversible and will be recorded on-chain. Please review the
                split details before confirming.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={closeModal}
                disabled={isSubmittingTx}
                className="px-4 py-2.5 border border-border-default text-text-primary text-sm font-medium rounded-md hover:bg-bg-elevated disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  closeModal();
                  void executeResolution(modal.sellerGetsBps!);
                }}
                disabled={isSubmittingTx}
                className="px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-md hover:bg-emerald-800 disabled:opacity-50 transition"
              >
                {isSubmittingTx ? "Processing..." : "Confirm & Sign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
