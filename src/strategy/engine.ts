// src/strategy/engine.ts — deterministic portfolio rebalance logic.
//
// Pure functions: given a portfolio state + config, decide whether to swap. No I/O, no
// randomness, no LLM — so the demo is fully reproducible. The agent loop applies the
// emitted DesiredAction through KeeperHub.

import type {
  DesiredAction,
  PortfolioSnapshot,
  PortfolioState,
  StrategyConfig,
} from './types.js';

function toNum(s: string | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function snapshot(state: PortfolioState): PortfolioSnapshot {
  const ethUsd = toNum(state.eth) * toNum(state.ethPriceUsd);
  const usdcUsd = toNum(state.usdc);
  const totalUsd = ethUsd + usdcUsd;
  const ethPct = totalUsd > 0 ? (ethUsd / totalUsd) * 100 : 0;
  const usdcPct = totalUsd > 0 ? 100 - ethPct : 0;
  return { ethUsd, usdcUsd, totalUsd, ethPct, usdcPct, driftPct: 0 };
}

/** How far the ETH allocation has drifted from target, in percentage points. */
export function drift(state: PortfolioState, targetEthPct: number): PortfolioSnapshot {
  const snap = snapshot(state);
  snap.driftPct = Math.abs(snap.ethPct - targetEthPct);
  return snap;
}

/**
 * Decide the rebalance action.
 *
 * - If ETH weight is above target by more than the threshold → sell ETH into USDC.
 * - If below target by more than the threshold → buy ETH with USDC.
 * - Otherwise → no-op.
 *
 * The swap size is sized to return ETH to exactly the target weight.
 */
export function decide(state: PortfolioState, cfg: StrategyConfig): DesiredAction {
  const snap = drift(state, cfg.target.ethPct);
  if (snap.totalUsd <= 0) {
    return { kind: 'no-op', reason: 'no portfolio value to rebalance' };
  }

  if (snap.driftPct <= cfg.driftThresholdPct) {
    return {
      kind: 'no-op',
      reason: `within band (ETH ${snap.ethPct.toFixed(1)}% vs target ${cfg.target.ethPct}%, drift ${snap.driftPct.toFixed(1)}ppt ≤ ${cfg.driftThresholdPct})`,
    };
  }

  const targetEthUsd = (cfg.target.ethPct / 100) * snap.totalUsd;
  const deltaEthUsd = snap.ethUsd - targetEthUsd; // + means overweight ETH
  const price = toNum(state.ethPriceUsd);

  if (deltaEthUsd > 0 && price > 0) {
    // overweight ETH → sell
    const amountEth = (deltaEthUsd / price).toFixed(6);
    return {
      kind: 'swap',
      side: 'sell-eth',
      amountEth,
      reason: `ETH ${snap.ethPct.toFixed(1)}% > target ${cfg.target.ethPct}%; sell ${amountEth} ETH to rebalance`,
    };
  }
  if (deltaEthUsd < 0 && price > 0) {
    // underweight ETH → buy
    const amountEth = Math.abs(deltaEthUsd / price).toFixed(6);
    return {
      kind: 'swap',
      side: 'buy-eth',
      amountEth,
      reason: `ETH ${snap.ethPct.toFixed(1)}% < target ${cfg.target.ethPct}%; buy ${amountEth} ETH to rebalance`,
    };
  }
  return { kind: 'no-op', reason: 'no actionable imbalance' };
}
