import { Readable } from "stream";
import { getPinataClient } from "../config/ipfs";
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
    /**
     * Upload a file buffer to IPFS via Pinata and pin it.
     * @returns The IPFS CID string
     */
    async uploadFile(buffer: Buffer, filename: string): Promise<string> {
        return TracingHelper.withSpan(
            "ipfs.upload_file",
            async (span) => {
                span.setAttributes({
                    'ipfs.operation': 'upload_file',
                    'ipfs.filename': filename,
                    'ipfs.file_size': buffer.length,
                });

                const pinata = getPinataClient();

                const stream = Readable.from(buffer) as unknown as NodeJS.ReadableStream & { path: string };
                stream.path = filename;

                TracingHelper.addEvent('ipfs_upload_start', { filename, size: buffer.length });

                try {
                    const result = await pinata.pinFileToIPFS(stream, {
                        pinataMetadata: { name: filename },
                        pinataOptions: { cidVersion: 1 },
                    });

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
    }

    /**
     * Build a public gateway URL for a given CID.
     */
    getFileUrl(cid: string): string {
        const gateway = process.env.IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
        return `${gateway.replace(/\/$/, "")}/${cid}`;
    }
}
