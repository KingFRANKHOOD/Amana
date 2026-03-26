import { IPFSService, ServiceUnavailableError } from "../services/ipfs.service";
import { __setPinataClientForTests, __resetPinataClient } from "../config/ipfs";

const mockPinFileToIPFS = jest.fn();

const mockPinataClient = {
    pinFileToIPFS: mockPinFileToIPFS,
} as any;

describe("IPFSService", () => {
    let service: IPFSService;

    beforeEach(() => {
        __setPinataClientForTests(mockPinataClient);
        service = new IPFSService();
        jest.clearAllMocks();
    });

    afterEach(() => {
        __resetPinataClient();
    });

    describe("uploadFile", () => {
        it("returns a valid CID string on success", async () => {
            mockPinFileToIPFS.mockResolvedValue({ IpfsHash: "bafybeiabc123" });

            const cid = await service.uploadFile(Buffer.from("test content"), "evidence.mp4");

            expect(cid).toBe("bafybeiabc123");
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(1);
        });

        it("throws ServiceUnavailableError when Pinata returns 500", async () => {
            mockPinFileToIPFS.mockRejectedValue(new Error("Internal Server Error"));

            await expect(
                service.uploadFile(Buffer.from("data"), "photo.jpg")
            ).rejects.toBeInstanceOf(ServiceUnavailableError);
        });

        it("ServiceUnavailableError has status 503", async () => {
            mockPinFileToIPFS.mockRejectedValue(new Error("Pinata down"));

            try {
                await service.uploadFile(Buffer.from("x"), "x.jpg");
            } catch (err) {
                expect((err as ServiceUnavailableError).status).toBe(503);
            }
        });
    });

    describe("getFileUrl", () => {
        it("builds URL from default gateway when env not set", () => {
            delete process.env.IPFS_GATEWAY_URL;
            const url = service.getFileUrl("bafybeiabc123");
            expect(url).toBe("https://gateway.pinata.cloud/ipfs/bafybeiabc123");
        });

        it("uses IPFS_GATEWAY_URL env var when set", () => {
            process.env.IPFS_GATEWAY_URL = "https://my-gateway.example.com/ipfs";
            const url = service.getFileUrl("bafybeiabc123");
            expect(url).toBe("https://my-gateway.example.com/ipfs/bafybeiabc123");
            delete process.env.IPFS_GATEWAY_URL;
        });
    });
});
