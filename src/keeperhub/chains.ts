// src/keeperhub/chains.ts — chain registry (verified live via GET /api/chains, 2026-07-15)
// plus the canonical USDC addresses from the hackathon quickstart.

import type { ChainInfo } from './types.js';

/** Minimal static registry for offline use; the live source of truth is GET /api/chains. */
export const CHAINS: readonly ChainInfo[] = [
  { id: 'eth', chainId: 1, name: 'Ethereum Mainnet', symbol: 'ETH', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: true, explorerUrl: 'https://etherscan.io' },
  { id: 'sep', chainId: 11155111, name: 'Ethereum Sepolia', symbol: 'ETH', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: true, explorerUrl: 'https://sepolia.etherscan.io' },
  { id: 'base', chainId: 8453, name: 'Base', symbol: 'BASE', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://basescan.org' },
  { id: 'basesep', chainId: 84532, name: 'Base Sepolia', symbol: 'BASE', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://sepolia.basescan.org' },
  { id: 'arb', chainId: 42161, name: 'Arbitrum One', symbol: 'ETH', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://arbiscan.io' },
  { id: 'arbsep', chainId: 421614, name: 'Arbitrum Sepolia', symbol: 'ETH', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://sepolia.arbiscan.io' },
  { id: 'op', chainId: 10, name: 'Optimism', symbol: 'ETH', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://optimistic.etherscan.io' },
  { id: 'opsep', chainId: 11155420, name: 'Optimism Sepolia', symbol: 'ETH', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://sepolia-optimism.etherscan.io' },
  { id: 'poly', chainId: 137, name: 'Polygon', symbol: 'MATIC', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://polygonscan.com' },
  { id: 'polyamoy', chainId: 80002, name: 'Polygon Amoy', symbol: 'MATIC', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: false, explorerUrl: 'https://amoy.polygonscan.com' },
  { id: 'tempo', chainId: 4217, name: 'Tempo', symbol: 'TEMPO', chainType: 'evm', isTestnet: false, isEnabled: true, usePrivateMempoolRpc: false },
  { id: 'tempotest', chainId: 42431, name: 'Tempo Testnet', symbol: 'TEMPO', chainType: 'evm', isTestnet: true, isEnabled: true, usePrivateMempoolRpc: false },
];

/** Canonical USDC addresses per chainId (from KeeperHub hackathon quickstart). */
export const USDC_BY_CHAIN: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
};

/** Resolve a friendly alias used in .env (sepolia, base-sepolia, ...) to a network string
 *  KeeperHub accepts. KeeperHub also accepts the numeric chainId directly. */
const ALIAS_TO_NETWORK: Record<string, string> = {
  sepolia: '11155111',
  'sepolia-testnet': '11155111',
  'base-sepolia': '84532',
  basesepolia: '84532',
  base: '8453',
  ethereum: '1',
  mainnet: '1',
  arbitrum: '42161',
  'arbitrum-sepolia': '421614',
  optimism: '10',
  polygon: '137',
  tempo: '4217',
};

export function resolveNetwork(input: string | number): string {
  if (typeof input === 'number') return String(input);
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed; // already a numeric chainId
  const lower = trimmed.toLowerCase();
  if (ALIAS_TO_NETWORK[lower]) return ALIAS_TO_NETWORK[lower];
  // fall back to the name as-is (KeeperHub accepts chain names)
  return trimmed;
}

export function findChain(chainId: number): ChainInfo | undefined {
  return CHAINS.find((c) => c.chainId === chainId);
}

/** MEV-protected (private mempool) chains — a headline KeeperHub feature. */
export function isMevProtected(chainId: number): boolean {
  return !!findChain(chainId)?.usePrivateMempoolRpc;
}
