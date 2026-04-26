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
  const [modal, setModal] = useState<ConfirmationModalState>({
    isOpen: false,
    sellerGetsBps: null,
    splitLabel: "",
  });

  // Dev-only state
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

  // Dev-only: generates a soroban:// URI for manual inspection
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
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-6xl mx-auto grid grid-cols-12 gap-6">
        {/* Left: Evidence Video */}
        <div className="col-span-7">
          <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-modal">
            <video
              controls
              className="w-full h-full object-contain bg-black"
              src={pinataUrl}
              onError={() => {
                if (activeGatewayIndex < PINATA_GATEWAYS.length - 1) {
                  setActiveGatewayIndex((prev) => prev + 1);
                }
              }}
            />
          </div>
          <div className="mt-3 text-sm text-gray-600 space-y-1">
            <div>Dispute ID: <span className="font-mono">{disputeId}</span></div>
            <div className="mt-2">
              {isMediator ? (
                <Badge variant="success">Authorized Mediator</Badge>
              ) : (
                <Badge variant="danger">Unauthorized</Badge>
              )}
            </div>

            {/* Dev-only: IPFS debug info */}
            {isDev && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs space-y-1">
                <div className="font-semibold text-yellow-700">DEV</div>
                <div>Pinata CID: {cid}</div>
                <div>Gateway: <Badge variant="info">{PINATA_GATEWAYS[activeGatewayIndex]}</Badge></div>
                <div>Wallet: {address ?? "Not connected"}</div>
                <button
                  onClick={() =>
                    setActiveGatewayIndex(
                      (prev) => (prev + 1) % PINATA_GATEWAYS.length,
                    )
                  }
                  className="px-2 py-1 bg-gray-100 rounded text-xs"
                >
                  Switch Gateway
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Resolution Panel */}
        <div className="col-span-5">
          <div className="bg-white rounded-xl shadow-md p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Resolve Dispute</h3>
              <p className="text-sm text-gray-500 mt-1">
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
                className="w-full rounded-md bg-black text-white py-2 text-sm font-medium"
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
              <p className="text-xs text-gray-600 break-all">{txStatus}</p>
            )}

            {/* Dev-only: exec string builder */}
            {isDev && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded space-y-2">
                <p className="text-xs font-semibold text-yellow-700">DEV — Exec String Builder</p>
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
                    onClick={(e) => { if (!execString) e.preventDefault(); }}
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Confirm Resolution</h2>

            <div className="border rounded-lg bg-gray-50 p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Trade ID:</span>
                <span className="text-sm font-mono text-gray-900">{disputeId}</span>
              </div>
              <div className="border-t border-gray-200" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Split:</span>
                <span className="text-sm font-semibold text-gray-900">{modal.splitLabel}</span>
              </div>
              <div className="border-t border-gray-200" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Seller Receives:</span>
                <span className="text-sm font-semibold text-emerald-700">
                  {(modal.sellerGetsBps / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Buyer Receives:</span>
                <span className="text-sm font-semibold text-blue-700">
                  {(getBuyerSplit(modal.sellerGetsBps) / 100).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
              <p className="text-xs text-yellow-800">
                <span className="font-semibold">⚠️ Warning:</span> This action is
                irreversible and will be recorded on-chain. Please review the split
                details before confirming.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={closeModal}
                disabled={isSubmittingTx}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  closeModal();
                  void executeResolution(modal.sellerGetsBps!);
                }}
                disabled={isSubmittingTx}
                className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-md hover:bg-emerald-800 disabled:opacity-50 transition"
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
