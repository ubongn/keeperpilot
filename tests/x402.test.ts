// tests/x402.test.ts — x402 requirement + verification logic (no key/network needed)
import { describe, expect, it } from 'vitest';
import { buildRequirement, verifyPayment } from '../src/x402/facilitator.js';

const PAY_TO = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;

describe('buildRequirement', () => {
  it('builds a base-usdc requirement priced in cents with the correct asset', () => {
    const r = buildRequirement({ settlement: 'base-usdc', amountUsdCents: 5, payTo: PAY_TO, resource: 'execute' });
    expect(r.scheme).toBe('exact');
    expect(r.network).toBe('base');
    expect(r.asset.toLowerCase()).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase());
    expect(r.price).toBe('5');
    expect(r.payTo.toLowerCase()).toBe(PAY_TO.toLowerCase());
    expect(Date.parse(r.expires)).toBeGreaterThan(Date.now());
  });
});

describe('verifyPayment', () => {
  it('accepts a matching trusted payment from a payer', () => {
    const r = buildRequirement({ settlement: 'base-usdc', amountUsdCents: 2, payTo: PAY_TO, resource: 'execute' });
    const payer = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
    const res = verifyPayment({ requirement: r, payload: '0x', from: payer }, r);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.from.toLowerCase()).toBe(payer.toLowerCase());
  });

  it('rejects a price mismatch', () => {
    const r = buildRequirement({ settlement: 'base-usdc', amountUsdCents: 2, payTo: PAY_TO, resource: 'execute' });
    const tampered = { ...r, price: '1' };
    const res = verifyPayment({ requirement: tampered, payload: '0x', from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}` }, r);
    expect(res.ok).toBe(false);
  });

  it('rejects an expired requirement', () => {
    const r = buildRequirement({ settlement: 'base-usdc', amountUsdCents: 2, payTo: PAY_TO, resource: 'execute' });
    const expired = { ...r, expires: new Date(Date.now() - 1000).toISOString() };
    const res = verifyPayment({ requirement: expired, payload: '0x', from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}` }, r);
    expect(res.ok).toBe(false);
  });

  it('rejects replay of the same requirement id', () => {
    const r = buildRequirement({ settlement: 'base-usdc', amountUsdCents: 2, payTo: PAY_TO, resource: 'execute' });
    const seen = new Set<string>();
    const from = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
    const first = verifyPayment({ requirement: r, payload: '0x', from }, r, { replayIds: seen });
    const second = verifyPayment({ requirement: r, payload: '0x', from }, r, { replayIds: seen });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });
});
