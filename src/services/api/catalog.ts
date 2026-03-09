import type { createApiClient } from './client';

type ApiClient = ReturnType<typeof createApiClient>;

export type CatalogProduct = {
  id: number;
  sku: string | null;
  name: string;
  price: number;
  barcode: string | null;
  active: boolean;
  service: boolean;
  group_name: string | null;
  allow_price_change: boolean;
  image_url?: string | null;
  image_thumb_url?: string | null;
  tile_color?: string | null;
};

export type ProductGroupAppearance = {
  path: string;
  image_url: string | null;
  image_thumb_url: string | null;
  tile_color: string | null;
};

export function fetchCatalogProducts(client: ApiClient) {
  return client.get<CatalogProduct[]>('/products');
}

export function fetchProductGroupAppearances(client: ApiClient) {
  return client.get<ProductGroupAppearance[]>('/product-groups');
}
