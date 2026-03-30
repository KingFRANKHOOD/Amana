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

type Props = { disputeId: string };

const DEFAULT_MEDIATOR_ADDRESSES = ["GEXAMPLEMEDIATORPUBLICKEY1"];

const PINATA_GATEWAYS = [
  process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL?.trim(),
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
].filter((value): value is string => Boolean(value));

const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

export default function MediatorPanelClient({ disputeId }: Props) {
  const { address, isAuthorized, isLoading, connectWallet } =
    useFreighterIdentity();
  const [execString, setExecString] = useState<string>("");
  const [txStatus, setTxStatus] = useState<string>("");
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);
  const [activeGatewayIndex, setActiveGatewayIndex] = useState(0);

  const mediatorAddresses = useMemo(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_MEDIATOR_WALLETS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    return fromEnv.length > 0 ? fromEnv : DEFAULT_MEDIATOR_ADDRESSES;
  }, []);

  const isMediator = Boolean(address && mediatorAddresses.includes(address));

  const cid = disputeId || "QmExampleCidForDemo";
  const pinataUrl = `${PINATA_GATEWAYS[activeGatewayIndex]}/${cid}`;

  function buildExec(split: string) {
    const s = `soroban://execute?cmd=resolve_dispute&split=${split}&dispute=${disputeId}`;
    setExecString(s);
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
          <div className="mt-3 text-sm text-gray-600">
            <div>Dispute ID: {disputeId}</div>
            <div>Pinata CID: {cid}</div>
            <div>Gateway: {PINATA_GATEWAYS[activeGatewayIndex]}</div>
            <div>Mapped address: {address ?? "Not connected"}</div>
            <div className="mt-2">
              {isMediator ? (
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded">
                  Mediator access
                </span>
              ) : (
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded">
                  Not a mediator
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-5">
          <div className="bg-white rounded-xl shadow-md p-5 space-y-4">
            <h3 className="text-lg font-semibold">Loss Ratio Executor</h3>
            <p className="text-sm text-gray-600">
              Resolve dispute with explicit seller payout basis points.
            </p>

            {!isAuthorized && (
              <button
                onClick={() => void connectWallet()}
                disabled={isLoading}
                className="w-full rounded-md bg-black text-white py-2"
              >
                {isLoading ? "Connecting..." : "Connect Freighter"}
              </button>
            )}

            {!isMediator && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-3">
                Unauthorized wallet. Access is restricted to mediator addresses.
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => buildExec("50-50")}
                className="w-full rounded-md border px-3 py-2 disabled:opacity-50"
              >
                Build 50/50 String
              </button>

              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => buildExec("70-30")}
                className="w-full rounded-md border px-3 py-2 disabled:opacity-50"
              >
                Build 70/30 String
              </button>

              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => void executeResolution(5000)}
                className="w-full rounded-md bg-emerald-700 text-white px-3 py-2 disabled:opacity-50"
              >
                Resolve 50/50 On-Chain
              </button>

              <button
                disabled={!isMediator || isSubmittingTx}
                onClick={() => void executeResolution(7000)}
                className="w-full rounded-md bg-emerald-700 text-white px-3 py-2 disabled:opacity-50"
              >
                Resolve 70/30 On-Chain
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Generated Execution String
              </label>
              <textarea
                readOnly
                value={execString}
                className="mt-1 block w-full rounded-md border-gray-200 shadow-sm h-24 p-2 text-sm"
              />
              <p className="mt-2 text-xs text-gray-600">{txStatus}</p>
              <div className="mt-2 flex gap-2">
                <button
                  disabled={!execString}
                  onClick={() => navigator.clipboard?.writeText(execString)}
                  className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                >
                  Copy
                </button>
                <a
                  href={execString || "#"}
                  onClick={(e) => {
                    if (!execString) e.preventDefault();
                  }}
                  className="px-3 py-1 bg-gray-100 rounded text-sm"
                >
                  Preview
                </a>
                <button
                  onClick={() =>
                    setActiveGatewayIndex(
                      (prev) => (prev + 1) % PINATA_GATEWAYS.length,
                    )
                  }
                  className="px-3 py-1 bg-gray-100 rounded text-sm"
                >
                  Switch Gateway
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
