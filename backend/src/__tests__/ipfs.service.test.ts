import { IPFSService, ServiceUnavailableError } from "../services/ipfs.service";
import { __setPinataClientForTests, __resetPinataClient } from "../config/ipfs";
import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";

const mockPinFileToIPFS = jest.fn();

const mockPinataClient = {
    pinFileToIPFS: mockPinFileToIPFS,
} as any;

describe("IPFSService", () => {
    let service: IPFSService;
    const sleepMock = jest.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        __setPinataClientForTests(mockPinataClient);
        __setRetrySleepForTests(sleepMock);
        service = new IPFSService();
        jest.clearAllMocks();
    });

    afterEach(() => {
        __resetPinataClient();
        __resetRetrySleepForTests();
    });

    describe("uploadFile", () => {
        it("returns a valid CID string on success", async () => {
            mockPinFileToIPFS.mockResolvedValue({ IpfsHash: "bafybeiabc123" });

            const cid = await service.uploadFile(Buffer.from("test content"), "evidence.mp4");

            expect(cid).toBe("bafybeiabc123");
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(1);
            expect(sleepMock).not.toHaveBeenCalled();
        });

        it("retries 500 errors and eventually succeeds", async () => {
            mockPinFileToIPFS
                .mockRejectedValueOnce({ response: { status: 500 } })
                .mockResolvedValueOnce({ IpfsHash: "bafybeiretry" });

            await expect(
                service.uploadFile(Buffer.from("data"), "photo.jpg")
            ).resolves.toBe("bafybeiretry");
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(2);
            expect(sleepMock).toHaveBeenCalledWith(1000);
        });

        it("retries 429 errors and eventually succeeds", async () => {
            mockPinFileToIPFS
                .mockRejectedValueOnce({ status: 429 })
                .mockRejectedValueOnce({ response: { status: 503 } })
                .mockResolvedValueOnce({ IpfsHash: "bafybeiratelimit" });

            await expect(
                service.uploadFile(Buffer.from("data"), "photo.jpg")
            ).resolves.toBe("bafybeiratelimit");
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(3);
            expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
            expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
        });

        it("throws ServiceUnavailableError when Pinata returns repeated 500s", async () => {
            mockPinFileToIPFS.mockRejectedValue({ response: { status: 500 } });

            await expect(
                service.uploadFile(Buffer.from("data"), "photo.jpg")
            ).rejects.toBeInstanceOf(ServiceUnavailableError);
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(4);
        });

        it("does not retry 400 errors", async () => {
            mockPinFileToIPFS.mockRejectedValue({ response: { status: 400 } });

            await expect(
                service.uploadFile(Buffer.from("x"), "x.jpg")
            ).rejects.toBeInstanceOf(ServiceUnavailableError);
            expect(mockPinFileToIPFS).toHaveBeenCalledTimes(1);
            expect(sleepMock).not.toHaveBeenCalled();
        });

        it("ServiceUnavailableError has status 503", async () => {
            mockPinFileToIPFS.mockRejectedValue({ response: { status: 503 } });

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
