import { Readable } from "stream";
import crypto from "crypto";
import axios from "axios";
import { getPinataClient } from "../config/ipfs";
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";
import { env } from "../config/env";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../lib/circuitBreaker";

export interface PinVerificationResult {
  pinned: boolean;
  cid: string;
  name?: string;
  size?: number;
  timestamp?: string;
  error?: string;
}

export class ServiceUnavailableError extends Error {
    status = 503;
    constructor(message = "IPFS service unavailable. Please retry shortly.") {
        super(message);
        this.name = "ServiceUnavailableError";
    }
}

export class IPFSService {
    private pinataCircuit: CircuitBreaker;

    constructor() {
      this.pinataCircuit = new CircuitBreaker("pinata-ipfs", {
        failureThreshold: env.IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD,
        successThreshold: 2,
        cooldownMs: env.IPFS_PINATA_CIRCUIT_COOLDOWN_MS,
      });
    }

    private getUploadTimeoutMs(): number {
        return env.IPFS_UPLOAD_TIMEOUT_MS;
    }

    private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
        return await new Promise<T>((resolve, reject) => {
            const handle = setTimeout(() => reject(new Error("IPFS upload timeout")), timeoutMs);
            operation
                .then((value) => {
                    clearTimeout(handle);
                    resolve(value);
                })
                .catch((error) => {
                    clearTimeout(handle);
                    reject(error);
                });
        });
    }

    /**
     * Upload a file buffer to IPFS via Pinata and pin it.
     * @returns The IPFS CID string
     */
    async uploadFile(buffer: Buffer, filename: string): Promise<string> {
        try {
          return await this.pinataCircuit.call(async () => {
            const pinata = getPinataClient();

            return TracingHelper.withSpan(
                "ipfs.upload_file",
                async (span) => {
                    span.setAttributes({
                        'ipfs.operation': 'upload_file',
                        'ipfs.filename': filename,
                        'ipfs.file_size': buffer.length,
                    });

                    const stream = Readable.from(buffer) as unknown as NodeJS.ReadableStream & { path: string };
                    stream.path = filename;

                    TracingHelper.addEvent('ipfs_upload_start', { filename, size: buffer.length });

                    try {
                        const timeoutMs = this.getUploadTimeoutMs();
                        const result = await retryAsync(() =>
                            this.withTimeout(
                                pinata.pinFileToIPFS(stream, {
                                    pinataMetadata: { name: filename },
                                    pinataOptions: { cidVersion: 1 },
                                }),
                                timeoutMs,
                            )
                        );

                        span.setAttributes({
                            'ipfs.cid': result.IpfsHash,
                            'ipfs.upload_success': true,
                        });

                        TracingHelper.addEvent('ipfs_upload_success', { 
                            cid: result.IpfsHash,
                            filename 
                        });

                        appLogger.info(
                            { 
                                cid: result.IpfsHash, 
                                filename, 
                                size: buffer.length 
                            }, 
                            "[IPFSService] File uploaded successfully"
                        );

                        return result.IpfsHash;
                    } catch (err) {
                        span.setAttributes({
                            'ipfs.upload_success': false,
                            'ipfs.error': err instanceof Error ? err.message : 'Unknown error',
                        });

                        TracingHelper.addEvent('ipfs_upload_error', { 
                            error: err instanceof Error ? err.message : 'Unknown error',
                            filename 
                        });

                        appLogger.error({ err, filename }, "[IPFSService] Pinata upload failed");
                        throw new ServiceUnavailableError();
                    }
                },
                {
                    attributes: {
                        'service.name': 'ipfs',
                        'operation.type': 'external_service',
                    }
                }
            );
          });
        } catch (err) {
          if (err instanceof CircuitBreakerOpenError) {
            throw new ServiceUnavailableError("IPFS upload circuit is temporarily open");
          }
          throw err;
        }
    }

    /**
     * Verify that a CID is pinned on Pinata by querying the Pinata data endpoints.
     * Returns detailed pin status including name, size, and timestamp.
     */
    async verifyPin(cid: string): Promise<PinVerificationResult> {
        try {
            return await this.pinataCircuit.call(async () => {
                const jwt = process.env.PINATA_JWT ?? env.PINATA_JWT;
                if (!jwt) {
                    return {
                        pinned: false,
                        cid,
                        error: "PINATA_JWT not configured",
                    };
                }

                const response = await axios.get(
                    `https://api.pinata.cloud/data/pinList?hashContains=${cid}&status=pinned&pageLimit=1`,
                    {
                        headers: { Authorization: `Bearer ${jwt}` },
                        timeout: 10_000,
                    },
                );

                const rows: Array<{
                    id: string;
                    ipfs_pin_hash: string;
                    name: string;
                    size: number;
                    date_pinned: string;
                }> = response.data?.rows ?? [];

                const match = rows.find((r) => r.ipfs_pin_hash === cid);

                if (!match) {
                    appLogger.warn({ cid }, "[IPFSService] CID not found in Pinata pins");
                    return { pinned: false, cid };
                }

                return {
                    pinned: true,
                    cid,
                    name: match.name,
                    size: match.size,
                    timestamp: match.date_pinned,
                };
            });
        } catch (err) {
            if (err instanceof CircuitBreakerOpenError) {
                return { pinned: false, cid, error: "Circuit breaker open" };
            }
            appLogger.error({ err, cid }, "[IPFSService] Pin verification failed");
            return {
                pinned: false,
                cid,
                error: err instanceof Error ? err.message : "Unknown error",
            };
        }
    }

    /**
     * Build a public gateway URL for a given CID.
     */
    getFileUrl(cid: string): string {
        const gateway = process.env.IPFS_GATEWAY_URL ?? env.IPFS_GATEWAY_URL;
        return `${gateway.replace(/\/$/, "")}/${cid}`;
    }

    /**
     * Creates a short-lived URL for a signature-aware IPFS gateway. Configure
     * the gateway with the same signing secret; public gateway URLs remain
     * compatible but do not themselves enforce this signature.
     */
    getSignedFileUrl(cid: string, ttlSeconds = env.IPFS_URL_TTL_SECONDS): { url: string; expiresAt: Date } {
        const safeTtl = Math.min(3600, Math.max(1, ttlSeconds));
        const expiresAt = new Date(Date.now() + safeTtl * 1000);
        const expires = Math.floor(expiresAt.getTime() / 1000);
        const secret = process.env.IPFS_URL_SIGNING_SECRET ?? env.IPFS_URL_SIGNING_SECRET ??
            process.env.JWT_SECRET ?? env.JWT_SECRET;
        const signature = crypto
            .createHmac("sha256", secret)
            .update(`${cid}:${expires}`)
            .digest("base64url");
        const url = new URL(this.getFileUrl(cid));
        url.searchParams.set("expires", String(expires));
        url.searchParams.set("signature", signature);
        return { url: url.toString(), expiresAt };
    }
}
