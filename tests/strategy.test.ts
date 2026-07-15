// tests/strategy.test.ts — deterministic rebalance logic
import { describe, expect, it } from 'vitest';
import { decide, drift, snapshot } from '../src/strategy/engine.js';
import type { PortfolioState, StrategyConfig } from '../src/strategy/types.js';

const cfg = (ethPct = 50): StrategyConfig => ({
  target: { ethPct, usdcPct: 100 - ethPct },
  driftThresholdPct: 5,
});

const state = (eth: string, usdc: string, price = '3000'): PortfolioState => ({
  eth, usdc, ethPriceUsd: price, network: 'sepolia',
});

describe('snapshot', () => {
  it('values ETH at price*amount and sums to total', () => {
    const s = snapshot(state('1', '3000', '3000'));
    expect(s.ethUsd).toBe(3000);
    expect(s.usdcUsd).toBe(3000);
    expect(s.totalUsd).toBe(6000);
    expect(s.ethPct).toBeCloseTo(50, 5);
  });

  it('handles empty portfolio without NaN', () => {
    const s = snapshot(state('0', '0'));
    expect(s.totalUsd).toBe(0);
    expect(Number.isNaN(s.ethPct)).toBe(false);
  });
});

describe('drift', () => {
  it('measures absolute ppt from target', () => {
    // ETH 1 @ 3000 = 3000; USDC 1000 => total 4000 => ETH 75% vs target 50% => drift 25
    const s = drift(state('1', '1000'), 50);
    expect(s.ethPct).toBeCloseTo(75, 5);
    expect(s.driftPct).toBeCloseTo(25, 5);
  });
});

describe('decide', () => {
  it('returns no-op within the drift band', () => {
    // 50/50 vs target 50 → drift 0
    const a = decide(state('1', '3000'), cfg(50));
    expect(a.kind).toBe('no-op');
  });

  it('returns no-op just under threshold', () => {
    // target 50, ETH slightly over but within 5ppt
    // total = 3000 + x, ethPct = 3000/total. ethPct=53 => total=5660 => usdc=2660
    const a = decide(state('1', '2660'), cfg(50));
    expect(a.kind).toBe('no-op');
  });

  it('emits a sell-eth when overweight beyond threshold', () => {
    // ETH 1 @ 3000 = 3000; USDC 1000 => 75% vs 50% target → sell
    const a = decide(state('1', '1000'), cfg(50));
    expect(a.kind).toBe('swap');
    if (a.kind === 'swap') {
      expect(a.side).toBe('sell-eth');
      // sized back to target: delta = 3000 - 0.5*4000 = 1000 usd => 0.333 eth
      expect(Number(a.amountEth)).toBeGreaterThan(0.3);
      expect(Number(a.amountEth)).toBeLessThan(0.34);
    }
  });

  it('emits a buy-eth when underweight beyond threshold', () => {
    // ETH 0.5 @ 3000 = 1500; USDC 4500 => 25% vs 50% target → buy
    const a = decide(state('0.5', '4500'), cfg(50));
    expect(a.kind).toBe('swap');
    if (a.kind === 'swap') expect(a.side).toBe('buy-eth');
  });

  it('respects a custom target allocation (e.g. 80/20)', () => {
    // 80/20 target; ETH 1 @ 3000 = 3000; USDC 3000 => 50% vs 80 → buy
    const a = decide(state('1', '3000'), cfg(80));
    expect(a.kind).toBe('swap');
    if (a.kind === 'swap') expect(a.side).toBe('buy-eth');
  });

  it('no-ops when there is no value', () => {
    const a = decide(state('0', '0'), cfg(50));
    expect(a.kind).toBe('no-op');
  });
});
