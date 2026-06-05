import { describe, expect, it } from "vitest";
import { calculateBreakEven, classifyBillingModel } from "./break-even.js";

describe("calculateBreakEven", () => {
  it("computes savings from on-chain burn vs delegated cost", () => {
    const result = calculateBreakEven({
      onChainBurnTrx: 13.5,
      monthlyTxVolume: 100,
    });
    expect(result.trxSavedPerTx).toBeCloseTo(13.155, 1);
    expect(result.annualSavingsTrx).toBeCloseTo(15786, 0);
  });

  it("returns zero savings when burn equals delegated cost", () => {
    const result = calculateBreakEven({
      onChainBurnTrx: 0.345,
      delegatedCostTrx: 0.345,
      monthlyTxVolume: 100,
    });
    expect(result.trxSavedPerTx).toBe(0);
  });
});

describe("classifyBillingModel", () => {
  it("classifies pass-through", () => {
    expect(classifyBillingModel(13.5, 13.4)).toBe("pass_through");
  });

  it("classifies marked-up", () => {
    expect(classifyBillingModel(15, 13)).toBe("marked_up");
  });

  it("classifies flat estimate", () => {
    expect(classifyBillingModel(10, 13.5)).toBe("flat_estimate");
  });
});
