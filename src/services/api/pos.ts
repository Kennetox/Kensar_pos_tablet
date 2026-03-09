import type { createApiClient } from './client';

type ApiClient = ReturnType<typeof createApiClient>;

export type NextSaleNumberResponse = {
  next_sale_number: number;
};

export type SaleNumberReservationPayload = {
  pos_name?: string;
  station_id?: string;
  min_sale_number?: number;
};

export type SaleNumberReservationResponse = {
  reservation_id: number;
  sale_number: number;
  document_number?: string | null;
  status?: string | null;
};

export type SaleItemPayload = {
  product_id: number;
  quantity: number;
  unit_price: number;
  product_sku?: string | null;
  product_name: string;
  product_barcode?: string | null;
  discount?: number;
  total?: number;
};

export type SaleCreatePayload = {
  payment_method: string;
  total: number;
  paid_amount: number;
  change_amount: number;
  items: SaleItemPayload[];
  payments?: { method: string; amount: number }[];
  surcharge_amount?: number;
  surcharge_label?: string;
  sale_number_preassigned: number;
  reservation_id?: number;
  notes?: string;
  pos_name?: string;
  vendor_name?: string;
  customer_id?: number;
  due_date?: string;
  station_id?: string;
};

export type SaleRead = {
  id: number;
  pos_name?: string | null;
  created_at?: string;
  status?: string;
  vendor_name?: string | null;
  total: number;
  paid_amount: number;
  change_amount: number;
  payment_method: string;
  sale_number?: number;
  document_number?: string | null;
  has_cash_payment?: boolean;
  notes?: string | null;
  items?: Array<{
    id?: number;
    product_name?: string;
    quantity?: number;
    unit_price?: number;
    total?: number;
    discount?: number;
    line_discount_value?: number;
  }>;
};

export type SalesHistoryPageResponse = {
  total: number;
  skip: number;
  limit: number;
  items: SaleRead[];
};

export type SaleDocumentType = 'ticket' | 'invoice';

export type SaleDocumentResponse = {
  sale_id: number;
  sale_number?: number | null;
  document_number?: string | null;
  document_type: SaleDocumentType;
  filename: string;
  document_html: string;
};

export function fetchNextSaleNumber(client: ApiClient, posId?: string) {
  const query = posId ? `?pos_id=${encodeURIComponent(posId)}` : '';
  return client.get<NextSaleNumberResponse>(`/pos/sales/next-number${query}`);
}

export function reserveSaleNumber(
  client: ApiClient,
  payload: SaleNumberReservationPayload,
) {
  return client.post<SaleNumberReservationResponse>('/pos/sales/reserve-number', payload);
}

export function cancelSaleReservation(client: ApiClient, reservationId: number) {
  return client.post<SaleNumberReservationResponse>(
    `/pos/sales/reservations/${reservationId}/cancel`,
  );
}

export function createSale(client: ApiClient, payload: SaleCreatePayload) {
  return client.post<SaleRead>('/pos/sales', payload);
}

export function fetchSalesHistoryPage(
  client: ApiClient,
  params?: {
    skip?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    pos?: string;
  },
) {
  const search = new URLSearchParams();
  if (typeof params?.skip === 'number' && params.skip >= 0) {
    search.set('skip', String(params.skip));
  }
  if (typeof params?.limit === 'number' && params.limit > 0) {
    search.set('limit', String(params.limit));
  }
  if (params?.dateFrom) {
    search.set('date_from', params.dateFrom);
  }
  if (params?.dateTo) {
    search.set('date_to', params.dateTo);
  }
  if (params?.pos) {
    search.set('pos', params.pos);
  }
  const query = search.toString();
  return client.get<SalesHistoryPageResponse>(`/pos/sales/history${query ? `?${query}` : ''}`);
}

export function fetchSaleDocument(
  client: ApiClient,
  saleId: number,
  documentType: SaleDocumentType,
) {
  return client.get<SaleDocumentResponse>(
    `/pos/sales/${saleId}/document?document_type=${encodeURIComponent(documentType)}`,
  );
}
