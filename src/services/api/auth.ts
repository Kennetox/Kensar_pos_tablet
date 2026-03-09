import { ApiError } from './client';
import type { createApiClient } from './client';

type ApiClient = ReturnType<typeof createApiClient>;

export type TabletLoginPayload = {
  station_id: string;
  pin: string;
  email?: string;
  device_id?: string;
  device_label?: string;
};

export type PosStationLoginPayload = {
  station_email: string;
  station_password: string;
  device_id?: string;
  device_label?: string;
};

export type LoginResponse = {
  access_token?: string;
  token?: string;
  token_type?: string;
  tenant?: {
    id?: number;
    slug?: string;
    name?: string;
  } | null;
  user?: {
    id: number;
    name: string;
    email?: string | null;
    role?: string | null;
  };
};

export type PosStationLoginResponse = {
  station_id: string;
  station_label: string;
  station_email: string;
  tenant_name?: string | null;
  parent_station_id?: string | null;
  parent_station_label?: string | null;
};

export async function tabletLogin(
  client: ApiClient,
  payload: TabletLoginPayload,
): Promise<LoginResponse> {
  try {
    return await client.post<LoginResponse>('/auth/tablet-login', payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return client.post<LoginResponse>('/auth/pos-login', payload);
    }
    throw error;
  }
}

export async function posStationLogin(
  client: ApiClient,
  payload: PosStationLoginPayload,
): Promise<PosStationLoginResponse> {
  return client.post<PosStationLoginResponse>('/auth/pos-station-login', payload);
}

export async function logoutSession(client: ApiClient): Promise<void> {
  await client.post('/auth/logout');
}
