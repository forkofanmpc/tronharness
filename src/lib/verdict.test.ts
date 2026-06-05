import { describe, expect, it } from "vitest";
import { classifyVerdict, isApproxEqual, isInRange } from "./verdict.js";

describe("isApproxEqual", () => {
  it("matches within 10% tolerance", () => {
    expect(isApproxEqual(0.34, 0.345)).toBe(true);
    expect(isApproxEqual(14, 13.5)).toBe(true);
  });

  it("rejects outside tolerance", () => {
    expect(isApproxEqual(10, 0.345)).toBe(false);
  });
});

describe("isInRange", () => {
  it("detects full burn range", () => {
    expect(isInRange(13.5, 13, 14)).toBe(true);
    expect(isInRange(5, 13, 14)).toBe(false);
  });
});

describe("classifyVerdict", () => {
  it("returns BYPASSABLE when Energy used and bandwidth-only burn", () => {
    const result = classifyVerdict({
      receipt: {
        energyUsage: 65000,
        energyFeeSun: 0,
        totalFeeTrx: 0.345,
      },
      knownDelegation: true,
      senderActivated: true,
    });
    expect(result.verdict).toBe("BYPASSABLE");
  });

  it("returns REAL_LIMITATION when zero Energy and full burn with delegation", () => {
    const result = classifyVerdict({
      receipt: {
        energyUsage: 0,
        energyFeeSun: 13_000_000,
        totalFeeTrx: 13.5,
      },
      knownDelegation: true,
      senderActivated: true,
    });
    expect(result.verdict).toBe("REAL_LIMITATION");
  });

  it("returns INCONCLUSIVE_NEW_ADDRESS for unactivated sender", () => {
    const result = classifyVerdict({
      receipt: {
        energyUsage: 0,
        energyFeeSun: 0,
        totalFeeTrx: 14,
      },
      knownDelegation: false,
      senderActivated: false,
    });
    expect(result.verdict).toBe("INCONCLUSIVE_NEW_ADDRESS");
  });

  it("returns OMNIBUS_BLOCKER for rotating addresses with low JIT", () => {
    const result = classifyVerdict({
      receipt: {
        energyUsage: 0,
        energyFeeSun: 0,
        totalFeeTrx: 5,
      },
      knownDelegation: false,
      senderActivated: true,
      rotationPattern: "rotating",
      jitFeasibility: "low",
    });
    expect(result.verdict).toBe("OMNIBUS_BLOCKER");
  });
});
