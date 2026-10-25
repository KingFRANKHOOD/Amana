import { renderHook } from "@testing-library/react";
import { useDraftForm } from "@/hooks/useDraftForm";
import { TradeDataSchema, type TradeData } from "@/app/trades/create/TradeContext";

const validDraft: TradeData = {
  commodity: "Maize",
  quantity: "500",
  unit: "kg",
  pricePerUnit: "450",
  currency: "NGN",
  sellerAddress: "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU",
  buyerRatio: 50,
  sellerRatio: 50,
  deliveryDays: "7",
  notes: "",
};

function storeRaw(payload: unknown) {
  const id = "draft-1";
  const key = `draft:trade:create:${id}`;
  const now = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(payload));
  localStorage.setItem(
    "drafts:meta:trade:create",
    JSON.stringify([{ id, key, createdAt: now, updatedAt: now, size: 1 }]),
  );
}

describe("useDraftForm with the create-trade schema", () => {
  beforeEach(() => localStorage.clear());

  it("loads a well-formed draft", () => {
    storeRaw(validDraft);
    const { result } = renderHook(() => useDraftForm<TradeData>("trade:create", TradeDataSchema));
    expect(result.current.load()).toEqual(validDraft);
  });

  it("rejects a corrupted draft so it is never passed to update()", () => {
    storeRaw({ ...validDraft, buyerRatio: "not-a-number", commodity: 42 });
    const { result } = renderHook(() => useDraftForm<TradeData>("trade:create", TradeDataSchema));
    expect(result.current.load()).toBeNull();
  });

  it("rejects a draft with the wrong shape", () => {
    storeRaw("tampered");
    const { result } = renderHook(() => useDraftForm<TradeData>("trade:create", TradeDataSchema));
    expect(result.current.load()).toBeNull();
  });
});
