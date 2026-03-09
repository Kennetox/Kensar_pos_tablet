import type { createApiClient } from './client';

type ApiClient = ReturnType<typeof createApiClient>;

export type PaymentMethodRecord = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  is_active: boolean;
  allow_change: boolean;
  order_index: number;
  color?: string | null;
  icon?: string | null;
};

export const DEFAULT_PAYMENT_METHODS: PaymentMethodRecord[] = [
  {
    id: -1,
    name: 'Efectivo',
    slug: 'cash',
    is_active: true,
    allow_change: true,
    order_index: 1,
  },
  {
    id: -2,
    name: 'Bancolombia QR / Transferencia',
    slug: 'qr',
    is_active: true,
    allow_change: false,
    order_index: 2,
  },
  {
    id: -3,
    name: 'Tarjeta Datáfono',
    slug: 'card',
    is_active: true,
    allow_change: false,
    order_index: 3,
  },
  {
    id: -4,
    name: 'Nequi',
    slug: 'nequi',
    is_active: true,
    allow_change: false,
    order_index: 4,
  },
  {
    id: -5,
    name: 'Daviplata',
    slug: 'daviplata',
    is_active: true,
    allow_change: false,
    order_index: 5,
  },
  {
    id: -6,
    name: 'Crédito',
    slug: 'credito',
    is_active: true,
    allow_change: false,
    order_index: 6,
  },
  {
    id: -7,
    name: 'Separado',
    slug: 'separado',
    is_active: true,
    allow_change: false,
    order_index: 7,
  },
];

export function fetchPaymentMethods(client: ApiClient) {
  return client.get<PaymentMethodRecord[]>('/pos/payment-methods');
}
