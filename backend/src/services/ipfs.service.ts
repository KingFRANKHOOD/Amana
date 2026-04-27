import { Readable } from "stream";
import { getPinataClient } from "../config/ipfs";
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";

export class ServiceUnavailableError extends Error {
    status = 503;
    constructor(message = "IPFS service unavailable. Please retry shortly.") {
        super(message);
        this.name = "ServiceUnavailableError";
    }
}

export class IPFSService {
    private static pinataCircuit = { failures: 0, openUntil: 0 };

    private getUploadTimeoutMs(): number {
        return parseInt(process.env.IPFS_UPLOAD_TIMEOUT_MS || "10000", 10);
    }

    private getCircuitThreshold(): number {
        return parseInt(process.env.IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD || "3", 10);
    }

    private getCircuitCooldownMs(): number {
        return parseInt(process.env.IPFS_PINATA_CIRCUIT_COOLDOWN_MS || "30000", 10);
    }

    private ensureCircuitClosed(): void {
        if (IPFSService.pinataCircuit.openUntil > Date.now()) {
            throw new ServiceUnavailableError("IPFS upload circuit is temporarily open");
        }
    }

    private onUploadSuccess(): void {
        IPFSService.pinataCircuit = { failures: 0, openUntil: 0 };
    }

    private onUploadFailure(): void {
        const failures = IPFSService.pinataCircuit.failures + 1;
        const threshold = this.getCircuitThreshold();
        if (failures >= threshold) {
            IPFSService.pinataCircuit = {
                failures,
                openUntil: Date.now() + this.getCircuitCooldownMs(),
            };
            return;
        }

        IPFSService.pinataCircuit = { failures, openUntil: 0 };
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
        this.ensureCircuitClosed();
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

                    this.onUploadSuccess();
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

                    this.onUploadFailure();
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
    }

    /**
     * Build a public gateway URL for a given CID.
     */
    getFileUrl(cid: string): string {
        const gateway = process.env.IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
        return `${gateway.replace(/\/$/, "")}/${cid}`;
    }

    static __resetCircuitForTests(): void {
        IPFSService.pinataCircuit = { failures: 0, openUntil: 0 };
    }
}
