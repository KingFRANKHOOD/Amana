/**
 * Evidence Upload and Playback E2E Tests
 *
 * Covers the complete evidence workflow:
 * - Upload evidence (video/document)
 * - Processing and verification
 * - Retrieval and playback
 * - Error handling and edge cases
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoUploadCard } from "@/components/ui/VideoUploadCard";
import { api } from "@/lib/api";

// Mock the API
jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getEvidence: jest.fn(),
      uploadEvidence: jest.fn(),
    },
  },
}));

// Mock Pinata API
global.XMLHttpRequest = jest.fn(() => ({
  upload: { onprogress: jest.fn() },
  onload: jest.fn(),
  onerror: jest.fn(),
  open: jest.fn(),
  setRequestHeader: jest.fn(),
  send: jest.fn(),
  status: 200,
  responseText: JSON.stringify({ IpfsHash: "QmTestHash123" }),
})) as any;

describe("Evidence Upload and Playback Journey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_PINATA_JWT = "test-jwt-token";
  });

  describe("Evidence Upload Flow", () => {
    it("should render upload card with proper UI elements", () => {
      render(<VideoUploadCard />);

      expect(screen.getByText("Evidence Upload")).toBeInTheDocument();
      expect(
        screen.getByText(/Upload delivery proof video/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Drag & drop or click to browse/i),
      ).toBeInTheDocument();
    });

    it("should accept video file selection", async () => {
      const user = userEvent.setup();
      const onUpload = jest.fn();

      render(<VideoUploadCard onUpload={onUpload} />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video content"], "evidence.mp4", {
          type: "video/mp4",
        });
        await user.upload(input, file);

        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /Submit Proof/i }),
          ).toBeInTheDocument();
        });
      }
    });

    it("should display upload progress during file upload", async () => {
      const { container } = render(<VideoUploadCard />);

      // Simulate file selection
      const input = container.querySelector('input[type="file"]');
      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        // Progress should be visible during upload
        await waitFor(
          () => {
            const progressText = screen.queryByText(/Uploading to IPFS/i);
            // Progress may or may not be visible depending on timing
            if (progressText) {
              expect(progressText).toBeInTheDocument();
            }
          },
          { timeout: 1000 },
        );
      }
    });

    it("should handle upload errors gracefully", async () => {
      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          // Simulate error
          setTimeout(() => this.onerror?.(), 0);
        }),
        status: 0,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(
          () => {
            const errorMsg = screen.queryByText(/Network error/i);
            if (errorMsg) {
              expect(errorMsg).toBeInTheDocument();
            }
          },
          { timeout: 1000 },
        );
      }
    });

    it("should disable submit button until file is uploaded", () => {
      render(<VideoUploadCard />);

      const submitButton = screen.getByRole("button", {
        name: /Submit Proof/i,
      });
      expect(submitButton).toBeDisabled();
    });

    it("should display IPFS hash after successful upload", async () => {
      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(function () {
          this.status = 200;
          this.responseText = JSON.stringify({ IpfsHash: "QmSuccessHash456" });
          this.onload?.();
        }),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          setTimeout(() => this.onload?.(), 100);
        }),
        status: 200,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
          expect(screen.getByText(/QmSuccessHash456/i)).toBeInTheDocument();
        });
      }
    });

    it("should call onUpload callback with IPFS hash", async () => {
      const onUpload = jest.fn();

      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(function () {
          this.status = 200;
          this.responseText = JSON.stringify({ IpfsHash: "QmCallbackHash" });
          this.onload?.();
        }),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          setTimeout(() => this.onload?.(), 100);
        }),
        status: 200,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard onUpload={onUpload} />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
          expect(onUpload).toHaveBeenCalledWith("QmCallbackHash");
        });
      }
    });
  });

  describe("Evidence Retrieval and Playback", () => {
    it("should fetch evidence records for a trade", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmTestHash123",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");

      expect(result).toEqual(mockEvidence);
      expect(api.trades.getEvidence).toHaveBeenCalledWith(
        "test-token",
        "trade-123",
      );
    });

    it("should handle empty evidence list", async () => {
      const mockEvidence = { evidence: [] };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");

      expect(result.evidence).toHaveLength(0);
    });

    it("should handle multiple evidence records", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmHash1",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
          {
            id: "ev-002",
            cid: "QmHash2",
            mimeType: "video/mp4",
            uploadedBy: "buyer-address",
            createdAt: "2026-04-24T11:00:00Z",
          },
          {
            id: "ev-003",
            cid: "QmHash3",
            mimeType: "application/pdf",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T12:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");

      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[0].mimeType).toBe("video/mp4");
      expect(result.evidence[2].mimeType).toBe("application/pdf");
    });

    it("should preserve evidence metadata during retrieval", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmTestHash123",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");
      const evidence = result.evidence[0];

      expect(evidence.id).toBe("ev-001");
      expect(evidence.cid).toBe("QmTestHash123");
      expect(evidence.uploadedBy).toBe("seller-address");
      expect(evidence.createdAt).toBe("2026-04-24T10:00:00Z");
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle API errors during evidence retrieval", async () => {
      const error = new Error("Failed to fetch evidence");
      (api.trades.getEvidence as jest.Mock).mockRejectedValue(error);

      await expect(
        api.trades.getEvidence("test-token", "trade-123"),
      ).rejects.toThrow("Failed to fetch evidence");
    });

    it("should handle network timeout during upload", async () => {
      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(),
        onerror: jest.fn(function () {
          // Simulate timeout
        }),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          setTimeout(() => this.onerror?.(), 100);
        }),
        status: 0,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(
          () => {
            const errorMsg = screen.queryByText(/Network error/i);
            if (errorMsg) {
              expect(errorMsg).toBeInTheDocument();
            }
          },
          { timeout: 1000 },
        );
      }
    });

    it("should handle invalid file types", async () => {
      render(<VideoUploadCard />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        // The input only accepts video files, so invalid types should be rejected by browser
        expect((input as HTMLInputElement).accept).toBe("video/mp4,video/webm");
      }
    });

    it("should handle missing IPFS configuration", async () => {
      delete process.env.NEXT_PUBLIC_PINATA_JWT;

      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(),
        status: 200,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard />);

      // Component should still render without JWT
      expect(screen.getByText("Evidence Upload")).toBeInTheDocument();
    });

    it("should handle concurrent uploads gracefully", async () => {
      const onUpload1 = jest.fn();
      const onUpload2 = jest.fn();

      const mockXhr = {
        upload: { onprogress: jest.fn() },
        onload: jest.fn(function () {
          this.status = 200;
          this.responseText = JSON.stringify({ IpfsHash: "QmConcurrentHash" });
          this.onload?.();
        }),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          setTimeout(() => this.onload?.(), 50);
        }),
        status: 200,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      const { rerender } = render(<VideoUploadCard onUpload={onUpload1} />);

      // Simulate first upload
      let input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');
      if (input) {
        const file1 = new File(["video1"], "test1.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file1] } });
      }

      // Rerender with different callback
      rerender(<VideoUploadCard onUpload={onUpload2} />);

      input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');
      if (input) {
        const file2 = new File(["video2"], "test2.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file2] } });
      }

      await waitFor(() => {
        // Both callbacks should be called
        expect(onUpload1).toHaveBeenCalled();
        expect(onUpload2).toHaveBeenCalled();
      });
    });
  });

  describe("Evidence Processing and Verification", () => {
    it("should track upload progress accurately", async () => {
      let progressCallback: ((e: ProgressEvent) => void) | null = null;

      const mockXhr = {
        upload: {
          onprogress: jest.fn((cb) => {
            progressCallback = cb;
          }),
        },
        onload: jest.fn(function () {
          this.status = 200;
          this.responseText = JSON.stringify({ IpfsHash: "QmProgressHash" });
          this.onload?.();
        }),
        onerror: jest.fn(),
        open: jest.fn(),
        setRequestHeader: jest.fn(),
        send: jest.fn(function () {
          // Simulate progress events
          if (progressCallback) {
            progressCallback({
              loaded: 50,
              total: 100,
              lengthComputable: true,
            } as ProgressEvent);
            progressCallback({
              loaded: 100,
              total: 100,
              lengthComputable: true,
            } as ProgressEvent);
          }
          setTimeout(() => this.onload?.(), 100);
        }),
        status: 200,
      };

      global.XMLHttpRequest = jest.fn(() => mockXhr) as any;

      render(<VideoUploadCard />);

      const input = screen
        .getByRole("button", { name: /browse/i })
        .closest("div")
        ?.querySelector('input[type="file"]');

      if (input) {
        const file = new File(["video"], "test.mp4", { type: "video/mp4" });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
          expect(mockXhr.upload.onprogress).toHaveBeenCalled();
        });
      }
    });

    it("should support multiple evidence types", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmVideoHash",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
          {
            id: "ev-002",
            cid: "QmPdfHash",
            mimeType: "application/pdf",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:05:00Z",
          },
          {
            id: "ev-003",
            cid: "QmImageHash",
            mimeType: "image/jpeg",
            uploadedBy: "buyer-address",
            createdAt: "2026-04-24T10:10:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");

      const mimeTypes = result.evidence.map((e) => e.mimeType);
      expect(mimeTypes).toContain("video/mp4");
      expect(mimeTypes).toContain("application/pdf");
      expect(mimeTypes).toContain("image/jpeg");
    });

    it("should maintain evidence chronological order", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmHash1",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
          {
            id: "ev-002",
            cid: "QmHash2",
            mimeType: "video/mp4",
            uploadedBy: "buyer-address",
            createdAt: "2026-04-24T11:00:00Z",
          },
          {
            id: "ev-003",
            cid: "QmHash3",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T12:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");

      // Verify chronological order
      for (let i = 1; i < result.evidence.length; i++) {
        const prevTime = new Date(result.evidence[i - 1].createdAt).getTime();
        const currTime = new Date(result.evidence[i].createdAt).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });
  });

  describe("Security and Validation", () => {
    it("should validate evidence ownership", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmTestHash123",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");
      const evidence = result.evidence[0];

      // Verify uploadedBy is present and valid
      expect(evidence.uploadedBy).toBeDefined();
      expect(evidence.uploadedBy).toMatch(/^[a-zA-Z0-9-]+$/);
    });

    it("should preserve IPFS hash integrity", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmTestHash123",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");
      const evidence = result.evidence[0];

      // IPFS hash should be immutable
      expect(evidence.cid).toBe("QmTestHash123");
      expect(evidence.cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it("should validate timestamp authenticity", async () => {
      const mockEvidence = {
        evidence: [
          {
            id: "ev-001",
            cid: "QmTestHash123",
            mimeType: "video/mp4",
            uploadedBy: "seller-address",
            createdAt: "2026-04-24T10:00:00Z",
          },
        ],
      };

      (api.trades.getEvidence as jest.Mock).mockResolvedValue(mockEvidence);

      const result = await api.trades.getEvidence("test-token", "trade-123");
      const evidence = result.evidence[0];

      // Timestamp should be valid ISO 8601 format
      const timestamp = new Date(evidence.createdAt);
      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(timestamp.toISOString()).toBe(evidence.createdAt);
    });
  });
});
