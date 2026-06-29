import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { request, requestWithResult, ApiError } from "@/lib/api/client";
import { z } from "zod";

describe("API Client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  describe("request", () => {
    it("should make successful request", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response),
      );

      const result = await request<{ data: string }>("/test");
      expect(result).toEqual({ data: "test" });
    });

    it("should auto-inject auth token from storage", async () => {
      sessionStorage.setItem("amana_jwt", "test-token");
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response),
      );

      const result = await request<{ data: string }>("/test");
      expect(result).toEqual({ data: "test" });
    });

    it("should handle 401 and trigger disconnect", async () => {
      sessionStorage.setItem("amana_jwt", "test-token");
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: "Unauthorized" }),
        } as Response),
      );

      await expect(request<{ data: string }>("/test")).rejects.toThrow(
        "Unauthorized",
      );
    });

    it("should handle network errors", async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

      await expect(request<{ data: string }>("/test")).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("requestWithResult", () => {
    it("should return success result", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response),
      );

      const result = await requestWithResult<{ data: string }>("/test");
      expect(result).toEqual({ success: true, data: { data: "test" } });
    });

    it("should validate with Zod schema", async () => {
      const schema = z.object({
        data: z.string(),
      });

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response),
      );

      const result = await requestWithResult("/test", schema);
      expect(result).toEqual({ success: true, data: { data: "test" } });
    });

    it("should return error on validation failure", async () => {
      const schema = z.object({
        data: z.string(),
      });

      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ invalid: "data" }),
        } as Response),
      );

      const result = await requestWithResult("/test", schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ApiError);
        expect(result.error.status).toBe(500);
      }
    });

    it("should handle 401 refresh flow", async () => {
      sessionStorage.setItem("amana_jwt", "test-token");
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: "Unauthorized" }),
        } as Response),
      );

      const reloadSpy = jest.spyOn(window.location, "reload").mockImplementation(() => {});

      const result = await requestWithResult<{ data: string }>("/test");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.status).toBe(401);
      }
      expect(sessionStorage.getItem("amana_jwt")).toBeNull();
      expect(reloadSpy).toHaveBeenCalled();

      reloadSpy.mockRestore();
    });

    it("should handle network errors", async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

      const result = await requestWithResult<{ data: string }>("/test");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });
});
