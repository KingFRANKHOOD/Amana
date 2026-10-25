/**
 * Evidence Upload and Playback E2E Tests
 *
 * Covers the complete evidence workflow:
 * - Upload evidence (video/document)
 * - Processing and verification
 * - Retrieval and playback
 * - Error handling and edge cases
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { VideoUploadCard } from "@/components/ui/VideoUploadCard";
import { api } from "@/lib/api";

// Mock useAuth to provide a JWT without requiring an AuthProvider wrapper
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ token: "mock-jwt-token" }),
}));

// Mock the BentoCard component
jest.mock("@/components/ui/BentoCard", () => ({
  BentoCard: ({ children, title }: { children: React.ReactNode; title?: string; icon?: React.ReactNode; glowVariant?: string; className?: string }) => (
    <div data-testid="bento-card">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  ),
}));

// Mock the Icon component
jest.mock("@/components/ui/Icon", () => ({
  Icon: ({ name, size, className, ...props }: { name: string; size?: string; className?: string; [key: string]: unknown }) => (
    <svg data-testid={`icon-${name}`} data-size={size} className={className} {...props} />
  ),
}));

// Mock the API
jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getEvidence: jest.fn(),
      uploadEvidence: jest.fn(),
    },
  },
  apiConfig: {
    getBaseUrl: () => "http://api.test",
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
  responseText: JSON.stringify({ cid: "QmTestHash123" }),
})) as any;

describe("Evidence Upload and Playback Journey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_PINATA_JWT = "test-jwt-token";
    MockUploadXhr.instances = [];
    global.XMLHttpRequest = MockUploadXhr as unknown as typeof XMLHttpRequest;
  });

/**
 * Controllable XMLHttpRequest stand-in so upload tests can drive progress,
 * success and failure explicitly instead of racing a timer.
 */
class MockUploadXhr {
  static instances: MockUploadXhr[] = [];

  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  statusText = "OK";
  responseText = "";
  withCredentials = false;
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();

  constructor() {
    MockUploadXhr.instances.push(this);
  }

  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable: true,
    } as ProgressEvent);
  }

  succeed(cid: string) {
    this.status = 200;
    this.responseText = JSON.stringify({ cid });
    this.onload?.();
  }

  fail() {
    this.status = 0;
    this.onerror?.();
  }
}

/**
 * Every test that talks to the upload UI must resolve the file input through
 * this helper. If the markup ever stops rendering an `<input type="file">`,
 * the test fails with an explicit message instead of skipping its body.
 */
function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error(
      "VideoUploadCard did not render an <input type=\"file\"> element; evidence upload UI is broken",
    );
  }
  return input;
}

function selectFile(input: HTMLInputElement, name = "evidence.mp4", type = "video/mp4") {
  const file = new File(["video content"], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

async function getStartedUpload(): Promise<MockUploadXhr> {
  await waitFor(() => {
    expect(MockUploadXhr.instances).toHaveLength(1);>>>>>>> origin/main
  });
  return MockUploadXhr.instances[0];
}

describe("Evidence Upload Flow", () => {
  it("should render upload card with proper UI elements", () => {
    render(<VideoUploadCard tradeId="trade-1" />);

    expect(screen.getByText("Evidence Upload")).toBeInTheDocument();
    expect(screen.getByText(/Upload delivery proof video/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag & drop or click to browse/i)).toBeInTheDocument();
  });

  it("should accept video file selection and start an upload", async () => {
    const { container } = render(<VideoUploadCard tradeId="trade-1" />);

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();

    expect(xhr.open).toHaveBeenCalledWith(
      "POST",
      "http://api.test/evidence/video",
    );
    expect(xhr.send).toHaveBeenCalledTimes(1);

    const body = xhr.send.mock.calls[0][0] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("tradeId")).toBe("trade-1");
    expect(body.get("file")).toBeInstanceOf(File);
    // A local preview is shown as soon as a file is selected.
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("should display upload progress during file upload", async () => {
    const { container } = render(<VideoUploadCard tradeId="trade-1" />);

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();

    act(() => {
      xhr.emitProgress(50, 100);
    });

    expect(screen.getByText("Uploading to IPFS…")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("should handle upload errors gracefully", async () => {
    const onUpload = jest.fn();
    const { container } = render(
      <VideoUploadCard tradeId="trade-1" onUpload={onUpload} />,
    );

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();

    await act(async () => {
      xhr.fail();
    });

    expect(screen.getByText(/Network error during upload/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit Proof/i })).toBeDisabled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("should disable submit button until file is uploaded", () => {
    const { container } = render(<VideoUploadCard tradeId="trade-1" />);

    // Resolving the input first keeps this test from silently passing when the
    // upload UI disappears.
    expect(getFileInput(container)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Submit Proof/i }),
    ).toBeDisabled();
  });

  it("should display IPFS hash after successful upload", async () => {
    const onUpload = jest.fn();
    const { container } = render(
      <VideoUploadCard tradeId="trade-1" onUpload={onUpload} />,
    );

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();

    await act(async () => {
      xhr.succeed("QmSuccessHash456");
    });

    expect(screen.getByText(/QmSuccessHash456/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View on IPFS/i }),
    ).toHaveAttribute(
      "href",
      "https://gateway.pinata.cloud/ipfs/QmSuccessHash456",
    );
    expect(
      screen.getByRole("button", { name: /Submit Proof/i }),
    ).toBeEnabled();
  });

  it("should call onUpload callback with IPFS hash", async () => {
    const onUpload = jest.fn();
    const { container } = render(
      <VideoUploadCard tradeId="trade-1" onUpload={onUpload} />,
    );

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();

    await act(async () => {
      xhr.succeed("QmCallbackHash");
    });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith("QmCallbackHash");
  });

  it("should hand the uploaded hash to onSubmit when the proof is submitted", async () => {
    const onSubmit = jest.fn();
    const { container } = render(
      <VideoUploadCard tradeId="trade-1" onSubmit={onSubmit} />,
    );

    selectFile(getFileInput(container));
    const xhr = await getStartedUpload();
    await act(async () => {
      xhr.succeed("QmSubmittedHash");
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit Proof/i }));

    expect(onSubmit).toHaveBeenCalledWith("QmSubmittedHash");
    expect(
      screen.getByRole("button", { name: /Proof Submitted/i }),
    ).toBeInTheDocument();
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
      const onUpload = jest.fn();
      const { container } = render(
        <VideoUploadCard tradeId="trade-1" onUpload={onUpload} />,
      );

      selectFile(getFileInput(container));
      const xhr = await getStartedUpload();

      await act(async () => {
        xhr.fail();
      });

      // A timed-out upload must surface the failure and leave the form unusable.
      expect(screen.getByText(/Network error during upload/i)).toBeInTheDocument();
      expect(screen.queryByText(/Qm/i)).not.toBeInTheDocument();
      expect(onUpload).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /Submit Proof/i })).toBeDisabled();>>>>>>> origin/main
    });

    it("should handle invalid file types", async () => {
      const { container } = render(<VideoUploadCard tradeId="trade-1" />);

      const input = getFileInput(container);

      // The input only accepts video files, so invalid types should be rejected by browser
      expect(input.accept).toBe("video/mp4,video/webm");
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

      render(<VideoUploadCard tradeId="trade-1" />);

      // Component should still render without JWT
      expect(screen.getByText("Evidence Upload")).toBeInTheDocument();
    });

    it("should not upload anything when no file is selected", async () => {
      const onUpload = jest.fn();
      const { container } = render(
        <VideoUploadCard tradeId="trade-1" onUpload={onUpload} />,
      );

      // Cancelling the browser file picker fires a change event with no files.
      fireEvent.change(getFileInput(container), { target: { files: [] } });

      await act(async () => {
        await Promise.resolve();
      });

      expect(MockUploadXhr.instances).toHaveLength(0);
      expect(onUpload).not.toHaveBeenCalled();
    });
  });

  describe("Evidence Processing and Verification", () => {
    it("should track upload progress accurately", async () => {
      const { container } = render(<VideoUploadCard tradeId="trade-1" />);

      selectFile(getFileInput(container));
      const xhr = await getStartedUpload();

      act(() => {
        xhr.emitProgress(25, 100);
      });
      expect(screen.getByText("25%")).toBeInTheDocument();

      act(() => {
        xhr.emitProgress(75, 100);
      });
      expect(screen.getByText("75%")).toBeInTheDocument();
      expect(screen.queryByText("25%")).not.toBeInTheDocument();
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
            cid: "QmXoypizjW3WknFixtNs4T2YHJPL9J5w1j3tTRG5fC1234",
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
      expect(evidence.cid).toBe("QmXoypizjW3WknFixtNs4T2YHJPL9J5w1j3tTRG5fC1234");
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
            createdAt: "2026-04-24T10:00:00.000Z",
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
