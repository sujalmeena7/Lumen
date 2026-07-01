import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BillingAndCaps from './BillingAndCaps';

function mockFetchSequence(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) return Promise.resolve({ ok: false, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => responses[key] });
  });
}

describe('BillingAndCaps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty state when no caps are configured', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': { caps: [] },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={true} />);

    await waitFor(() => expect(screen.getByText(/No spending caps configured/)).toBeInTheDocument());
  });

  it('renders configured caps with usage vs limit and a progress bar', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': {
        caps: [
          { id: 'cap1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 100, currentSpendUsd: 42 },
        ],
      },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={true} />);

    await waitFor(() => expect(screen.getByText('Entire workspace')).toBeInTheDocument());
    expect(screen.getByText('$42.00 / $100.00')).toBeInTheDocument();
  });

  it('resolves a per-member cap to the member email', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': {
        caps: [
          { id: 'cap1', workspaceId: 'ws1', memberId: 'mem1', monthlyLimitUsd: 20, currentSpendUsd: 5 },
        ],
      },
      '/api/workspaces/members': { members: [{ memberId: 'mem1', email: 'dev@example.com', role: 'member' }] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={true} />);

    await waitFor(() => expect(screen.getByText('dev@example.com')).toBeInTheDocument());
  });

  it('hides the "Set Cap" form and remove buttons for non-admins', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': {
        caps: [{ id: 'cap1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 100, currentSpendUsd: 10 }],
      },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={false} />);

    await waitFor(() => expect(screen.getByText('Entire workspace')).toBeInTheDocument());
    expect(screen.queryByText('Set Cap')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove cap')).not.toBeInTheDocument();
  });

  it('shows the subscribe form when there is no active subscription (admin only)', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': { caps: [] },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={true} />);

    await waitFor(() => expect(screen.getByPlaceholderText('Razorpay Plan ID')).toBeInTheDocument());
  });

  it('shows a cancel button when there is an active subscription (admin only)', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': { caps: [] },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' },
    });
    render(<BillingAndCaps isAdmin={true} />);

    await waitFor(() => expect(screen.getByText('Cancel Subscription')).toBeInTheDocument());
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('hides subscribe/cancel actions entirely for non-admins', async () => {
    global.fetch = mockFetchSequence({
      '/api/spending-caps': { caps: [] },
      '/api/workspaces/members': { members: [] },
      '/api/billing/status': { customerId: null, subscriptionId: null, status: 'none' },
    });
    render(<BillingAndCaps isAdmin={false} />);

    await waitFor(() => expect(screen.getByText('none')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('Razorpay Plan ID')).not.toBeInTheDocument();
  });

  it('submits a new workspace-wide cap', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/spending-caps' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ cap: {} }) });
      }
      if (url.includes('/api/spending-caps')) return Promise.resolve({ ok: true, json: async () => ({ caps: [] }) });
      if (url.includes('/api/workspaces/members')) return Promise.resolve({ ok: true, json: async () => ({ members: [] }) });
      if (url.includes('/api/billing/status'))
        return Promise.resolve({ ok: true, json: async () => ({ customerId: null, subscriptionId: null, status: 'none' }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    global.fetch = fetchMock;

    render(<BillingAndCaps isAdmin={true} />);
    await waitFor(() => expect(screen.getByPlaceholderText('Monthly limit (USD)')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Monthly limit (USD)'), { target: { value: '1500' } });
    fireEvent.click(screen.getByText('Set Cap'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/spending-caps',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
