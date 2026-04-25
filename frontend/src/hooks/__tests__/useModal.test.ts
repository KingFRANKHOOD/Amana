import { act, renderHook } from "@testing-library/react";
import { useModal } from "../useModal";

describe("useModal", () => {
  it("is closed by default", () => {
    const { result } = renderHook(() => useModal());
    expect(result.current.isOpen).toBe(false);
  });

  it("supports defaultOpen", () => {
    const { result } = renderHook(() => useModal({ defaultOpen: true }));
    expect(result.current.isOpen).toBe(true);
  });

  it("opens, closes, and toggles", () => {
    const { result } = renderHook(() => useModal());

    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
