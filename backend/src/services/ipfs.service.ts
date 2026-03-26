import { Readable } from "stream";
import { getPinataClient } from "../config/ipfs";

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
        const pinata = getPinataClient();

        const stream = Readable.from(buffer) as unknown as NodeJS.ReadableStream & { path: string };
        stream.path = filename;

        try {
            const result = await pinata.pinFileToIPFS(stream, {
                pinataMetadata: { name: filename },
                pinataOptions: { cidVersion: 1 },
            });
            return result.IpfsHash;
        } catch (err) {
            console.error("[IPFSService] Pinata upload failed:", err);
            throw new ServiceUnavailableError();
        }
    }

    /**
     * Build a public gateway URL for a given CID.
     */
    getFileUrl(cid: string): string {
        const gateway = process.env.IPFS_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
        return `${gateway.replace(/\/$/, "")}/${cid}`;
    }
}
