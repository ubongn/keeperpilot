// src/x402/gateway.ts — pay-per-execution HTTP gateway.
//
// Exposes paid endpoints: a client pays USDC (x402) per call, and on settlement the
// gateway fulfills the requested onchain action through KeeperHub. This is the x402
// KeeperHub surface (judging criteria #2).

import express, { type Request, type Response } from 'express';
import { AuditLog } from '../observability/audit.js';
import type { KeeperHubClient } from '../keeperhub/client.js';
import {
  buildRequirement,
  verifyPayment,
  type PaymentPayload,
  type PaymentRequirement,
  type Settlement,
} from './facilitator.js';

export interface GatewayConfig {
  client: KeeperHubClient;
  audit: AuditLog;
  port: number;
  settlement: Settlement;
  payTo: `0x${string}`;
  /** price per execution call, in USDC cents. */
  priceCents: number;
}

const seenRequirementIds = new Set<string>();

/** Parse a base64url or base64 `X-PAYMENT` header into a PaymentPayload. */
function parsePaymentHeader(req: Request): PaymentPayload | null {
  const raw = req.get('X-PAYMENT');
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as PaymentPayload;
    return parsed ?? null;
  } catch {
    return null;
  }
}

/** Write a 402 with the x402 WWW-Authenticate challenge + requirement body. */
function challenge(res: Response, req: PaymentRequirement) {
  const www = [
    `x402 realm="keeperpilot"`,
    `price="${req.price}"`,
    `asset="${req.asset}"`,
    `network="${req.network}"`,
    `pay_to="${req.payTo}"`,
    `id="${req.id}"`,
    `expires="${req.expires}"`,
  ].join(', ');
  res
    .status(402)
    .set('WWW-Authenticate', www)
    .json({
      x402Version: 1,
      error: 'Payment Required',
      accepts: [req],
    });
}

export function createGateway(cfg: GatewayConfig): express.Application {
  const app = express();
  app.use(express.json());

  // Health + the requirement discovery endpoint (no payment).
  app.get('/health', (_req, res) => res.json({ ok: true, settlement: cfg.settlement }));

  /**
   * POST /execute  — paid endpoint.
   * Body: { network, recipientAddress, amount, tokenAddress? }
   * Returns the real tx link after KeeperHub execution.
   */
  app.post('/execute', async (req: Request, res: Response) => {
    const requirement = buildRequirement({
      settlement: cfg.settlement,
      amountUsdCents: cfg.priceCents,
      payTo: cfg.payTo,
      resource: 'execute',
    });

    const payment = parsePaymentHeader(req);
    if (!payment) return challenge(res, requirement);

    const verified = verifyPayment(payment, requirement, { replayIds: seenRequirementIds });
    if (!verified.ok) {
      cfg.audit.record({ kind: 'x402_payment', level: 'warn', message: `payment rejected: ${verified.reason}` });
      return res.status(402).json({ error: 'payment_invalid', reason: verified.reason });
    }

    cfg.audit.record({
      kind: 'x402_payment',
      level: 'info',
      message: `payment accepted from ${verified.from} (${cfg.priceCents} USDC cents on ${cfg.settlement})`,
      data: { from: verified.from, cents: cfg.priceCents, settlement: cfg.settlement },
    });

    const { network, recipientAddress, amount, tokenAddress } = req.body ?? {};
    if (!network || !recipientAddress || !amount) {
      return res.status(400).json({ error: 'missing fields: network, recipientAddress, amount' });
    }

    try {
      const { executionId } = await cfg.client.transfer({ network, recipientAddress, amount, tokenAddress }, {});
      const final = await cfg.client.waitForCompletion(executionId);
      cfg.audit.recordExecution(network, final, `x402-paid execution for ${verified.from}`);
      return res.json({
        ok: final.status === 'completed',
        status: final.status,
        executionId: final.executionId,
        transactionHash: final.transactionHash,
        transactionLink: final.transactionLink,
        paidBy: verified.from,
      });
    } catch (e) {
      cfg.audit.record({ kind: 'system', level: 'error', message: `x402 fulfillment failed: ${asMsg(e)}` });
      return res.status(502).json({ error: 'execution_failed', reason: asMsg(e) });
    }
  });

  return app;
}

export async function startGateway(cfg: GatewayConfig): Promise<ReturnType<express.Application['listen']>> {
  const app = createGateway(cfg);
  const server = app.listen(cfg.port, () => {
    cfg.audit.record({
      kind: 'system',
      level: 'info',
      message: `x402 gateway listening on :${cfg.port} (settlement ${cfg.settlement}, price ${cfg.priceCents}c/call)`,
    });
  });
  return server;
}

function asMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { PaymentRequirement };
