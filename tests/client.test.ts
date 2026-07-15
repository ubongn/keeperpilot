// tests/client.test.ts — KeeperHub client reliability surface (mock fetch, no key needed)
import { describe, expect, it } from 'vitest';
import {
  AuthError,
  IdempotencyConflictError,
  KeeperHubClient,
  RateLimitError,
  SpendingCapError,
  WalletNotConfiguredError,
} from '../src/keeperhub/index.js';

/** Builds a fetch impl that returns queued Responses in order. */
function mockFetch(queue: { status?: number; body?: unknown; headers?: Record<string, string> }[]) {
  let i = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue[Math.min(i, queue.length - 1)];
    i++;
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { fn, calls, count: () => i };
}

const baseClient = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  new KeeperHubClient({
    baseUrl: 'https://app.keeperhub.com',
    apiKey: 'kh_test',
    fetchImpl,
    maxRetries: 3,
    baseBackoffMs: 1, // keep tests fast
    pollTimeoutMs: 3000,
    ...extra,
  });

describe('KeeperHubClient.transfer', () => {
  it('POSTs to /api/execute/transfer and returns the executionId', async () => {
    const m = mockFetch([{ status: 200, body: { executionId: 'direct_1', status: 'pending' } }]);
    const c = baseClient(m.fn);
    const res = await c.transfer({ network: 'sepolia', recipientAddress: '0xabc', amount: '0.1' });
    expect(res.executionId).toBe('direct_1');
    expect(m.calls[0]!.url).toContain('/api/execute/transfer');
  });

  it('attaches an Idempotency-Key header', async () => {
    const m = mockFetch([{ body: { executionId: 'x', status: 'pending' } }]);
    const c = baseClient(m.fn);
    await c.transfer({ network: 'sepolia', recipientAddress: '0xabc', amount: '0.1' }, { idempotencyKey: 'fixed-key' });
    const headers = m.calls[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('fixed-key');
  });

  it('forces simulate:true in dry-run mode', async () => {
    const m = mockFetch([{ body: { executionId: 'x', status: 'completed' } }]);
    const c = baseClient(m.fn, { dryRun: true });
    await c.transfer({ network: 'sepolia', recipientAddress: '0xabc', amount: '0.1' });
    const sent = JSON.parse(m.calls[0]!.init.body as string);
    expect(sent.simulate).toBe(true);
  });
});

describe('KeeperHubClient retries', () => {
  it('retries on 429 then succeeds', async () => {
    const m = mockFetch([
      { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '0' } },
      { status: 200, body: { executionId: 'ok', status: 'pending' } },
    ]);
    const c = baseClient(m.fn);
    const res = await c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' });
    expect(res.executionId).toBe('ok');
    expect(m.count()).toBe(2);
  });

  it('retries on 500 then succeeds', async () => {
    const m = mockFetch([
      { status: 500, body: { error: 'boom' } },
      { status: 200, body: { executionId: 'ok', status: 'pending' } },
    ]);
    const c = baseClient(m.fn);
    const res = await c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' });
    expect(res.executionId).toBe('ok');
  });

  it('throws AuthError immediately on 401 (non-retriable)', async () => {
    const m = mockFetch([{ status: 401, body: { error: 'bad key' } }]);
    const c = baseClient(m.fn);
    await expect(c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' })).rejects.toBeInstanceOf(AuthError);
    expect(m.count()).toBe(1); // no retry
  });

  it('maps 422 WALLET_NOT_CONFIGURED to typed error', async () => {
    const m = mockFetch([{ status: 422, body: { error: 'no wallet', code: 'WALLET_NOT_CONFIGURED' } }]);
    const c = baseClient(m.fn);
    await expect(c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' })).rejects.toBeInstanceOf(WalletNotConfiguredError);
  });

  it('maps 409 to IdempotencyConflictError', async () => {
    const m = mockFetch([{ status: 409, body: { error: 'conflict', originalExecutionId: 'old' } }]);
    const c = baseClient(m.fn);
    await expect(c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('maps 403 spending-cap to SpendingCapError', async () => {
    const m = mockFetch([{ status: 403, body: { error: 'Daily spending cap exceeded' } }]);
    const c = baseClient(m.fn);
    await expect(c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' })).rejects.toBeInstanceOf(SpendingCapError);
  });

  it('gives up after maxRetries on persistent 429', async () => {
    const m = mockFetch([{ status: 429, body: { error: 'nope' }, headers: { 'Retry-After': '0' } }]);
    const c = baseClient(m.fn, { maxRetries: 2 });
    await expect(c.transfer({ network: 'sepolia', recipientAddress: '0x', amount: '0.1' })).rejects.toBeInstanceOf(RateLimitError);
    expect(m.count()).toBe(3); // 1 + 2 retries
  });
});

describe('KeeperHubClient.waitForCompletion', () => {
  it('polls until completed and honors X-Poll-Interval-Hint, returning the tx link', async () => {
    const m = mockFetch([
      { status: 200, body: { executionId: 'e', status: 'running' }, headers: { 'X-Poll-Interval-Hint': '0' } },
      { status: 200, body: { executionId: 'e', status: 'completed', transactionHash: '0xdead', transactionLink: 'https://sepolia.etherscan.io/tx/0xdead' } },
    ]);
    const c = baseClient(m.fn);
    const final = await c.waitForCompletion('e');
    expect(final.status).toBe('completed');
    expect(final.transactionHash).toBe('0xdead');
    expect(final.transactionLink).toContain('0xdead');
  });

  it('returns the failed status for a failed execution', async () => {
    const m = mockFetch([
      { status: 200, body: { executionId: 'e', status: 'failed', error: 'reverted' }, headers: { 'X-Poll-Interval-Hint': '0' } },
    ]);
    const c = baseClient(m.fn);
    const final = await c.waitForCompletion('e');
    expect(final.status).toBe('failed');
  });
});

describe('KeeperHubClient.transferAndConfirm', () => {
  it('executes then confirms, surfacing the explorer link', async () => {
    const m = mockFetch([
      { status: 200, body: { executionId: 'e', status: 'pending' } },
      { status: 200, body: { executionId: 'e', status: 'completed', transactionLink: 'https://x.io/0x1' }, headers: { 'X-Poll-Interval-Hint': '0' } },
    ]);
    const c = baseClient(m.fn);
    const res = await c.transferAndConfirm({ network: 'sepolia', recipientAddress: '0x', amount: '0.001' });
    expect(res.transactionLink).toBe('https://x.io/0x1');
  });
});
