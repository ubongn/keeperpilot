// src/strategy/types.ts

export interface PortfolioState {
  /** Decimal-string balances (human units, e.g. "1.5"). */
  eth: string;
  usdc: string;
  /** USD price of one ETH (decimal string). */
  ethPriceUsd: string;
  network: string;
}

export interface TargetAllocation {
  ethPct: number; // 0..100
  usdcPct: number; // 0..100
}

export interface StrategyConfig {
  target: TargetAllocation;
  /** Rebalance when actual drift exceeds this many percentage points. */
  driftThresholdPct: number;
}

/** A desired market action produced by the strategy. */
export type DesiredAction =
  | { kind: 'swap'; side: 'sell-eth' | 'buy-eth'; amountEth: string; reason: string }
  | { kind: 'no-op'; reason: string };

export interface PortfolioSnapshot {
  ethUsd: number;
  usdcUsd: number;
  totalUsd: number;
  ethPct: number;
  usdcPct: number;
  driftPct: number; // absolute drift from target ETH pct
}
