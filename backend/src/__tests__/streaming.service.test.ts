import axios from "axios";
import { Readable } from "stream";
import { EvidenceService } from "../services/evidence.service";
import { ServiceUnavailableError } from "../services/ipfs.service";

function createMockPrisma() {
    return {
        trade: { findUnique: jest.fn() },
        tradeEvidence: { findMany: jest.fn(), create: jest.fn() },
    } as any;
}

describe("EvidenceService.streamFromIPFS gateway fallback and range support", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let service: EvidenceService;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new EvidenceService(prisma);
        jest.restoreAllMocks();
        delete process.env.IPFS_GATEWAY_URLS;
        delete process.env.IPFS_GATEWAY_ALLOWLIST;
        delete process.env.IPFS_STREAM_TIMEOUT_MS;
        delete process.env.IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD;
        delete process.env.IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS;
    });

    it("tries gateways in order and returns from the second when the first fails", async () => {
        process.env.IPFS_GATEWAY_URLS = "https://g1.example.com/ipfs,https://g2.example.com/ipfs";

        const payload = Buffer.from("hello world gateway2");
        jest.spyOn(axios, "get").mockImplementation(async (url: string, opts: any) => {
            if (url.includes("g1.example.com")) {
                throw new Error("gateway1 timeout");
            }
            return {
                status: 200,
                data: Readable.from(payload),
                headers: { "content-type": "video/mp4" },
            } as any;
        });

        const res = await service.streamFromIPFS("bafy123");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("video/mp4");
        expect((axios.get as jest.Mock).mock.calls[0][1]).toEqual(
            expect.objectContaining({ timeout: 5000 }),
        );

        const chunks: Buffer[] = [];
        for await (const chunk of res.data) chunks.push(Buffer.from(chunk));
        const buf = Buffer.concat(chunks);
        expect(buf.equals(payload)).toBe(true);
    });

    it("supports Range requests and returns 206 with partial buffer", async () => {
        process.env.IPFS_GATEWAY_URLS = "https://g.example.com/ipfs";
        const full = Buffer.from("abcdefghijklmnopqrstuvwxyz");
        // return a 206 and stream the requested slice
        jest.spyOn(axios, "get").mockImplementation(async (url: string, opts: any) => {
            const range = opts.headers?.Range as string | undefined;
            // simulate Range: bytes=5-9
            const start = range ? Number(range.replace(/bytes=(\d+)-.*/, "$1")) : 0;
            const end = start + 4;
            const slice = full.slice(start, end + 1);
            return {
                status: 206,
                data: Readable.from(slice),
                headers: {
                    "content-type": "video/mp4",
                    "content-range": `bytes ${start}-${end}/${full.length}`,
                    "content-length": String(slice.length),
                },
            } as any;
        });

        const rangeHeader = "bytes=5-9";
        const res = await service.streamFromIPFS("bafy123", rangeHeader);
        expect(res.status).toBe(206);
        expect(res.headers["content-type"]).toBe("video/mp4");

        const chunks: Buffer[] = [];
        for await (const chunk of res.data) chunks.push(Buffer.from(chunk));
        const buf = Buffer.concat(chunks);
        expect(buf.equals(full.slice(5, 10))).toBe(true);
    });

    it("throws ServiceUnavailableError when all gateways fail", async () => {
        process.env.IPFS_GATEWAY_URLS = "https://g1.example.com/ipfs,https://g2.example.com/ipfs";
        jest.spyOn(axios, "get").mockImplementation(async () => {
            throw new Error("down");
        });

        await expect(service.streamFromIPFS("bafy123")).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it("enforces gateway allowlist", async () => {
        process.env.IPFS_GATEWAY_URLS = "https://blocked.example.com/ipfs";
        process.env.IPFS_GATEWAY_ALLOWLIST = "allowed.example.com";
        const getSpy = jest.spyOn(axios, "get").mockResolvedValue({
            status: 200,
            data: Readable.from(Buffer.from("ok")),
            headers: { "content-type": "video/mp4" },
        } as any);

        await expect(service.streamFromIPFS("bafy123")).rejects.toBeInstanceOf(ServiceUnavailableError);
        expect(getSpy).not.toHaveBeenCalled();
    });

    it("opens circuit for repeatedly failing gateway and falls back", async () => {
        process.env.IPFS_GATEWAY_URLS = "https://g1.example.com/ipfs,https://g2.example.com/ipfs";
        process.env.IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD = "1";
        process.env.IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS = "60000";

        jest.spyOn(axios, "get").mockImplementation(async (url: string) => {
            if (url.includes("g1.example.com")) {
                throw new Error("gateway 1 down");
            }
            return {
                status: 200,
                data: Readable.from(Buffer.from("ok")),
                headers: { "content-type": "video/mp4" },
            } as any;
        });

        await service.streamFromIPFS("bafy123");
        await service.streamFromIPFS("bafy123");

        const attemptedUrls = (axios.get as jest.Mock).mock.calls.map((c) => c[0] as string);
        const g1Attempts = attemptedUrls.filter((u) => u.includes("g1.example.com")).length;
        const g2Attempts = attemptedUrls.filter((u) => u.includes("g2.example.com")).length;

        expect(g1Attempts).toBe(1);
        expect(g2Attempts).toBe(2);
    });
});
