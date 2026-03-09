import type { createApiClient } from './client';

type ApiClient = ReturnType<typeof createApiClient>;

export type PosCustomerRecord = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
  address?: string | null;
};

export type CreatePosCustomerPayload = {
  name: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  address?: string;
  is_active?: boolean;
};

export async function fetchPosCustomers(
  client: ApiClient,
  params?: { search?: string; skip?: number; limit?: number },
) {
  const query = new URLSearchParams();
  if (params?.search) {
    query.set('search', params.search);
  }
  if (typeof params?.skip === 'number') {
    query.set('skip', String(Math.max(0, Math.floor(params.skip))));
  }
  if (typeof params?.limit === 'number') {
    query.set('limit', String(Math.max(1, Math.floor(params.limit))));
  }

  const suffix = query.toString();
  const data = await client.get<PosCustomerRecord[] | { items?: PosCustomerRecord[] }>(
    `/pos/customers${suffix ? `?${suffix}` : ''}`,
  );

  if (Array.isArray(data)) {
    return data;
  }
  return Array.isArray(data?.items) ? data.items : [];
}

export function createPosCustomer(client: ApiClient, payload: CreatePosCustomerPayload) {
  return client.post<PosCustomerRecord>('/pos/customers', payload);
}
