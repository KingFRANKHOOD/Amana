import { Response } from "express";
import { AuthRequest } from "../services/auth.service";

jest.mock("../services/feature-flags.service", () => ({
  featureFlagService: {
    isEnabled: jest.fn(),
  },
}));

import { featureFlagService } from "../services/feature-flags.service";
import { requireFeature } from "../middleware/requireFeature";

const mockFeatureFlagService = featureFlagService as unknown as { isEnabled: jest.Mock };

function createRes() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("requireFeature middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls next() when the feature is enabled for the user", async () => {
    mockFeatureFlagService.isEnabled.mockResolvedValue(true);
    const req = { user: { sub: "user-1" } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    await requireFeature("new-checkout")(req, res, next);

    expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith("new-checkout", "user-1");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 503 when the feature is disabled", async () => {
    mockFeatureFlagService.isEnabled.mockResolvedValue(false);
    const req = { user: { sub: "user-1" } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    await requireFeature("new-checkout")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      code: "FEATURE_DISABLED",
      error: "Feature 'new-checkout' is currently disabled",
    });
  });

  it("falls back to walletAddress when sub is absent", async () => {
    mockFeatureFlagService.isEnabled.mockResolvedValue(true);
    const req = { user: { walletAddress: "GABC" } } as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    await requireFeature("new-checkout")(req, res, next);

    expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith("new-checkout", "GABC");
  });

  it("passes undefined userId for unauthenticated requests", async () => {
    mockFeatureFlagService.isEnabled.mockResolvedValue(false);
    const req = {} as AuthRequest;
    const res = createRes();
    const next = jest.fn();

    await requireFeature("new-checkout")(req, res, next);

    expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith("new-checkout", undefined);
  });
});
