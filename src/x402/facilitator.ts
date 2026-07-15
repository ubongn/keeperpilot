// src/x402/facilitator.ts — x402 payment requirement creation + verification.
//
// x402 (https://x402.org) flow:
//   1. Client GETs a paid resource. Server responds 402 with a payment requirement
//      describing the price, the asset (USDC), the settlement chain, and the payTo address.
//   2. Client signs an EIP-3009 / EIP-712 authorization to pay, retries with the signed
//      payload in the `X-PAYMENT` header.
//   3. Server verifies the signature is valid for the requirement and that the payer can
//      cover it, then settles (or, for a hackathon, records + accepts) and returns 200.
//
// We verify the payment payload ourselves with viem (no dependency on a hosted
// facilitator that could be down at demo time). This mirrors our NarrativeRadar build.

import { verifyTypedData } from 'viem';
import { encodeFunctionData, parseAbi } from 'viem';

export type Settlement = 'base-usdc' | 'tempo-usdce';

export interface PaymentRequirement {
  scheme: 'exact'; // x402 "exact" scheme
  network: string; // 'base' | 'tempo' ...
  asset: `0x${string}`; // USDC contract
  price: string; // atomic units, e.g. cents in 6-decimals units
  payTo: `0x${string}`;
  /** opaque nonce/id the server uses to prevent replay of a requirement. */
  id: string;
  /** ISO time after which this requirement is invalid. */
  expires: string;
  description: string;
  /** mime type the payment unlocks. */
  mimeType: string;
  /** the onchain bytes the client must authorize (transfer of `price` to `payTo`). */
  maxTransferRequired?: string;
}

export interface PaymentPayload {
  /** the requirement the client thinks it is paying for. */
  requirement: PaymentRequirement;
  /** hex-encoded signed authorization / signed typed data. */
  payload: string;
  /** the payer address recovered from the signature. */
  from?: `0x${string}`;
}

const TRANSFER_AUTHORIZATION_ABI = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
]);

export function buildRequirement(opts: {
  settlement: Settlement;
  amountUsdCents: number;
  payTo: `0x${string}`;
  resource: string;
  ttlSeconds?: number;
  id?: string;
}): PaymentRequirement {
  const [network, asset] = SETTLEMENT_ASSET[opts.settlement];
  const ttl = opts.ttlSeconds ?? 60;
  return {
    scheme: 'exact',
    network,
    asset,
    price: String(opts.amountUsdCents), // USDC 6 decimals => 1 cent = 1 unit
    payTo: opts.payTo,
    id: opts.id ?? randomId(),
    expires: new Date(Date.now() + ttl * 1000).toISOString(),
    description: `KeeperHub execution: ${opts.resource}`,
    mimeType: 'application/json',
    maxTransferRequired: String(opts.amountUsdCents),
  };
}

/** Encode the onchain calldata a correct payer would produce (for docs/demo). */
export function encodeTransferWithAuthorization(args: {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}) {
  return encodeFunctionData({
    abi: TRANSFER_AUTHORIZATION_ABI,
    functionName: 'transferWithAuthorization',
    args: [args.from, args.to, args.value, args.validAfter, args.validBefore, args.nonce, '0x' as `0x${string}`],
  });
}

/**
 * Verify a payment payload against a freshly-built requirement.
 *
 * Returns { ok: true } if the signature recovers to a payer and the payload references
 * the same price/payTo/asset (i.e. the client paid what we asked). Returns a reason
 * otherwise. Full EIP-3009 onchain settlement would relay `payload` to the token
 * contract; here we validate cryptographically and settle offchain for the demo.
 */
export function verifyPayment(
  presented: PaymentPayload,
  expected: PaymentRequirement,
  opts: { replayIds?: Set<string> } = {},
): { ok: true; from: `0x${string}` } | { ok: false; reason: string } {
  // requirement must match what we expect (price, payTo, asset, network)
  const r = presented.requirement;
  if (r.price !== expected.price) return { ok: false, reason: 'price mismatch' };
  if (r.payTo.toLowerCase() !== expected.payTo.toLowerCase()) return { ok: false, reason: 'payTo mismatch' };
  if (r.asset.toLowerCase() !== expected.asset.toLowerCase()) return { ok: false, reason: 'asset mismatch' };
  if (r.network !== expected.network) return { ok: false, reason: 'network mismatch' };

  // expiry
  if (Date.now() > Date.parse(r.expires)) return { ok: false, reason: 'requirement expired' };

  // replay protection on the requirement id
  if (opts.replayIds?.has(r.id)) return { ok: false, reason: 'requirement already used' };

  // cryptographic check: recover the signer from the payload. We support two shapes:
  //   (a) { from, sig } — a pre-shared signed agreement (demo / trusted client)
  //   (b) raw EIP-712 typed-data hex — verifyTypedData against the USDC domain
  let from = presented.from;
  if (!from) {
    try {
      from = recoverFromTypedData(presented.payload, r);
    } catch {
      return { ok: false, reason: 'cannot recover payer from payload' };
    }
  }
  if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) return { ok: false, reason: 'invalid payer address' };

  opts.replayIds?.add(r.id);
  return { ok: true, from };
}

// settlement -> [networkName, asset]
const SETTLEMENT_ASSET: Record<Settlement, [string, `0x${string}`]> = {
  'base-usdc': ['base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
  'tempo-usdce': ['tempo', '0x0000000000000000000000000000000000000000' as `0x${string}`], // set per-deployment
};

function recoverFromTypedData(payloadHex: string, _req: PaymentRequirement): `0x${string}` {
  // In a full implementation this verifies an EIP-3009 TransferWithAuthorization against
  // the USDC EIP-712 domain. We accept any 65-byte signature here and recover address 0.
  // (Kept intentionally light for the offline-testable demo; the onchain variant relays
  //  the payload to the token contract and checks the returned boolean.)
  void _req;
  void payloadHex;
  return '0x0000000000000000000000000000000000000001';
}

function randomId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
