jest.mock("../../lib/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  },
}));

import { redis } from "../../lib/redis";
import { FeatureFlagService, FeatureFlagRecord } from "../feature-flags.service";

const mockRedis = redis as unknown as {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  keys: jest.Mock;
};

describe("FeatureFlagService", () => {
  let service: FeatureFlagService;

  beforeEach(() => {
    service = new FeatureFlagService();
    jest.clearAllMocks();
  });

  describe("setFlag / getFlag", () => {
    it("stores a flag under feature:<name> and returns the record", async () => {
      const record = await service.setFlag("new-checkout", { enabled: true });

      expect(mockRedis.set).toHaveBeenCalledWith(
        "feature:new-checkout",
        expect.stringContaining('"enabled":true'),
      );
      expect(record.enabled).toBe(true);
      expect(record.updatedAt).toEqual(expect.any(String));
    });

    it("rejects an out-of-range rolloutPercentage", async () => {
      await expect(
        service.setFlag("new-checkout", { enabled: true, rolloutPercentage: 101 }),
      ).rejects.toThrow(RangeError);
      await expect(
        service.setFlag("new-checkout", { enabled: true, rolloutPercentage: -1 }),
      ).rejects.toThrow(RangeError);
    });

    it("returns null when the flag doesn't exist", async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await service.getFlag("missing")).toBeNull();
    });

    it("returns null instead of throwing on corrupt stored JSON", async () => {
      mockRedis.get.mockResolvedValue("{not-json");
      expect(await service.getFlag("corrupt")).toBeNull();
    });
  });

  describe("listFlags", () => {
    it("returns an empty object when no flags are set", async () => {
      mockRedis.keys.mockResolvedValue([]);
      expect(await service.listFlags()).toEqual({});
    });

    it("reads back every feature:* key, stripping the prefix", async () => {
      const a: FeatureFlagRecord = { enabled: true, updatedAt: "t1" };
      const b: FeatureFlagRecord = { enabled: false, updatedAt: "t2" };
      mockRedis.keys.mockResolvedValue(["feature:a", "feature:b"]);
      mockRedis.get.mockImplementation((key: string) => {
        if (key === "feature:a") return Promise.resolve(JSON.stringify(a));
        if (key === "feature:b") return Promise.resolve(JSON.stringify(b));
        return Promise.resolve(null);
      });

      expect(await service.listFlags()).toEqual({ a, b });
    });
  });

  describe("isEnabled", () => {
    it("is false when the flag doesn't exist", async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await service.isEnabled("missing")).toBe(false);
    });

    it("is false when the flag is explicitly disabled", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ enabled: false, updatedAt: "t" }));
      expect(await service.isEnabled("off")).toBe(false);
    });

    it("is true for a plain enabled flag with no rollout", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ enabled: true, updatedAt: "t" }));
      expect(await service.isEnabled("on")).toBe(true);
    });

    it("is true when rolloutPercentage is 100", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ enabled: true, rolloutPercentage: 100, updatedAt: "t" }),
      );
      expect(await service.isEnabled("on", "user-1")).toBe(true);
    });

    it("is false when rolloutPercentage is 0", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ enabled: true, rolloutPercentage: 0, updatedAt: "t" }),
      );
      expect(await service.isEnabled("off", "user-1")).toBe(false);
    });

    it("is false for a partial rollout with no userId to gate on", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ enabled: true, rolloutPercentage: 50, updatedAt: "t" }),
      );
      expect(await service.isEnabled("partial")).toBe(false);
    });

    it("is deterministic: the same user gets the same result across repeated checks", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ enabled: true, rolloutPercentage: 50, updatedAt: "t" }),
      );

      const first = await service.isEnabled("partial", "user-42");
      const second = await service.isEnabled("partial", "user-42");
      const third = await service.isEnabled("partial", "user-42");

      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it("distributes a rollout percentage roughly evenly across many users", async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ enabled: true, rolloutPercentage: 30, updatedAt: "t" }),
      );

      const sampleSize = 2000;
      let enabledCount = 0;
      for (let i = 0; i < sampleSize; i++) {
        if (await service.isEnabled("partial", `user-${i}`)) {
          enabledCount += 1;
        }
      }

      const ratio = enabledCount / sampleSize;
      // Allow generous slack (target 30% +/- 7pp) since this is a hash-based
      // approximation, not a perfectly uniform distribution.
      expect(ratio).toBeGreaterThan(0.23);
      expect(ratio).toBeLessThan(0.37);
    });
  });

  describe("deleteFlag", () => {
    it("deletes the underlying redis key", async () => {
      await service.deleteFlag("gone");
      expect(mockRedis.del).toHaveBeenCalledWith("feature:gone");
    });
  });
});
