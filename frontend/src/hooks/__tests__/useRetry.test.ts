import { renderHook, act } from "@testing-library/react";
import { useRetry } from "../useRetry";

describe("useRetry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("executes function successfully on first attempt", async () => {
    const fn = jest.fn().mockResolvedValue("success");
    const { result } = renderHook(() => useRetry(fn));

    let data: string | null = null;
    await act(async () => {
      data = await result.current.execute();
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(data).toBe("success");
    expect(result.current.state.data).toBe("success");
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.isLoading).toBe(false);
  });

  it("retries on failure and succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");
    const { result } = renderHook(() => useRetry(fn));

    await act(async () => {
      await result.current.execute();
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.state.data).toBe("success");
    expect(result.current.state.attempt).toBe(1);
  });

  it("stops retrying after max attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useRetry(fn, { maxAttempts: 2 }));

    await act(async () => {
      await result.current.execute();
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.state.error).toBeDefined();
    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.isRetrying).toBe(false);
  });

  it("does not retry non-retryable status", async () => {
    const error = new Error("bad request");
    (error as { status: number }).status = 400;
    const fn = jest.fn().mockRejectedValue(error);
    const { result } = renderHook(() =>
      useRetry(fn, { retryableStatuses: [500, 503] })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.state.error).toBeDefined();
    const err = result.current.state.error as { status: number };
    expect(err.status).toBe(400);
  });

  it("resets state correctly", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useRetry(fn));

    await act(async () => {
      await result.current.execute();
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.data).toBeNull();
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.attempt).toBe(0);
    expect(result.current.state.isLoading).toBe(false);
  });
});