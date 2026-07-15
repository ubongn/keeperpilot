// src/keeperhub/errors.ts — typed errors for the KeeperHub client

import type { ExecutionStatusResponse } from './types.js';

export class KeeperHubError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'KeeperHubError';
  }
}

/** 401 / missing key. */
export class AuthError extends KeeperHubError {
  constructor(message: string, details?: unknown) {
    super(message, 401, 'auth_error', details);
    this.name = 'AuthError';
  }
}

/** 422 — usually wallet not configured. */
export class WalletNotConfiguredError extends KeeperHubError {
  constructor(message = 'Wallet not configured (set it in the KeeperHub dashboard)', details?: unknown) {
    super(message, 422, 'WALLET_NOT_CONFIGURED', details);
    this.name = 'WalletNotConfiguredError';
  }
}

/** 429 — rate limited; carries Retry-After seconds. */
export class RateLimitError extends KeeperHubError {
  constructor(message: string, public readonly retryAfterSec?: number, details?: unknown) {
    super(message, 429, 'rate_limited', details);
    this.name = 'RateLimitError';
  }
}

/** 409 — idempotency conflict. */
export class IdempotencyConflictError extends KeeperHubError {
  constructor(message: string, public readonly originalExecutionId?: string, details?: unknown) {
    super(message, 409, 'idempotency_conflict', details);
    this.name = 'IdempotencyConflictError';
  }
}

/** 403 — daily spending cap exceeded. */
export class SpendingCapError extends KeeperHubError {
  constructor(message = 'Daily spending cap exceeded', details?: unknown) {
    super(message, 403, 'spending_cap_exceeded', details);
    this.name = 'SpendingCapError';
  }
}

/** The onchain execution itself failed (status: failed). */
export class ExecutionFailedError extends KeeperHubError {
  constructor(
    message: string,
    public readonly execution: ExecutionStatusResponse,
  ) {
    super(message, undefined, 'execution_failed', execution);
    this.name = 'ExecutionFailedError';
  }
}

/** Polling exceeded the timeout without a terminal status. */
export class PollTimeoutError extends KeeperHubError {
  constructor(message: string, public readonly lastStatus: ExecutionStatusResponse) {
    super(message, undefined, 'poll_timeout');
    this.name = 'PollTimeoutError';
  }
}

/** Is this status code worth retrying (transient)? */
export function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
