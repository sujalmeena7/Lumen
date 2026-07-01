import { describe, it, expect } from 'vitest';
import { MeteringService } from './metering.js';
import { FakeBillingProvider } from './fakeProvider.js';
import type { RequestLogStore } from '../stores/types.js';

function makeLogStore(costUsd: number): RequestLogStore {
  return {
    create: async () => {},
    sumCostSince: async () => costUsd,
  };
}

describe('MeteringService', () => {
  it('charges usage in INR paise (converted from USD) for a subscribed workspace', async () => {
    const billing = new FakeBillingProvider();
    const service = new MeteringService(billing, makeLogStore(1), { usdToInrRate: 83 });
    const result = await service.reportUsageSince(
      { id: 'ws1', name: 'WS', razorpayCustomerId: 'cus_1' },
      new Date(),
    );
    // $1 * 83 INR/USD * 100 paise/INR = 8300 paise.
    expect(result).toEqual({ chargedPaise: 8300, orderId: expect.any(String) });
    expect(billing.reportedUsage).toHaveLength(1);
    expect(billing.reportedUsage[0]).toMatchObject({ customerId: 'cus_1', amountPaise: 8300 });
  });

  it('no-ops for a workspace with no Razorpay customer', async () => {
    const billing = new FakeBillingProvider();
    const service = new MeteringService(billing, makeLogStore(5), { usdToInrRate: 83 });
    const result = await service.reportUsageSince({ id: 'ws1', name: 'WS' }, new Date());
    expect(result).toBeNull();
    expect(billing.reportedUsage).toHaveLength(0);
  });

  it('reports zero without calling billing when there is no cost to report', async () => {
    const billing = new FakeBillingProvider();
    const service = new MeteringService(billing, makeLogStore(0), { usdToInrRate: 83 });
    const result = await service.reportUsageSince(
      { id: 'ws1', name: 'WS', razorpayCustomerId: 'cus_1' },
      new Date(),
    );
    expect(result).toEqual({ chargedPaise: 0, orderId: null });
    expect(billing.reportedUsage).toHaveLength(0);
  });

  it('uses a deterministic idempotency key (receipt) for the same workspace+hour bucket', async () => {
    const billing = new FakeBillingProvider();
    const service = new MeteringService(billing, makeLogStore(2), { usdToInrRate: 83 });
    const since = new Date('2025-01-01T10:00:00Z');
    await service.reportUsageSince({ id: 'ws1', name: 'WS', razorpayCustomerId: 'cus_1' }, since);
    await service.reportUsageSince({ id: 'ws1', name: 'WS', razorpayCustomerId: 'cus_1' }, since);
    expect(billing.reportedUsage[0]!.idempotencyKey).toBe(billing.reportedUsage[1]!.idempotencyKey);
  });
});
