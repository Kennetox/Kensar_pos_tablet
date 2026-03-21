import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { createApiClient } from '../services/api/client';
import { fetchSalesHistoryPage, type SaleRead } from '../services/api/pos';
import type { PaymentMethodRecord } from '../services/api/paymentMethods';

type ApiClient = ReturnType<typeof createApiClient>;

type SalesHistoryScreenProps = {
  apiClient: ApiClient;
  paymentMethods: PaymentMethodRecord[];
  onBack: () => void;
  onShowToast: (message: string, duration?: number, tone?: 'info' | 'error') => void;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatHistoryDateTime(value?: string | null) {
  if (!value) {
    return 'Sin fecha';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    hour12: true,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getBogotaDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function getBogotaDateKeyFromIso(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return getBogotaDateKey(parsed);
}

export function SalesHistoryScreen({
  apiClient,
  paymentMethods,
  onBack,
  onShowToast,
}: SalesHistoryScreenProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SaleRead[]>([]);
  const [total, setTotal] = useState(0);
  const [bogotaTimeLabel, setBogotaTimeLabel] = useState('');

  const resolvePaymentMethodName = useCallback(
    (method?: string | null) => {
      const slug = (method ?? '').trim().toLowerCase();
      if (!slug) {
        return 'Sin método';
      }
      return paymentMethods.find((item) => item.slug === slug)?.name ?? slug;
    },
    [paymentMethods],
  );

  const todayKey = useMemo(() => getBogotaDateKey(), []);

  const loadSalesHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchSalesHistoryPage(apiClient, {
        skip: 0,
        limit: 100,
        dateFrom: todayKey,
        dateTo: todayKey,
      });
      const onlyToday = (payload.items ?? []).filter(
        (sale) => getBogotaDateKeyFromIso(sale.created_at) === todayKey,
      );
      setItems(onlyToday);
      setTotal(onlyToday.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial de ventas.');
    } finally {
      setLoading(false);
    }
  }, [apiClient, todayKey]);

  useEffect(() => {
    loadSalesHistory().catch(() => undefined);
  }, [loadSalesHistory]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setBogotaTimeLabel(
        now.toLocaleTimeString('es-CO', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZone: 'America/Bogota',
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(10, insets.top + 4),
            paddingBottom: Math.max(12, insets.bottom + 8),
          },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={styles.kicker}>Historial de hoy</Text>
            <Text style={styles.title}>Ventas del día</Text>
            <Text style={styles.meta}>Fecha {todayKey} · Incluye ventas de la tablet y estación principal</Text>
            <Text style={styles.meta}>Hora {bogotaTimeLabel || '--:--:--'} </Text>
            <Text style={styles.meta}>Mostrando {items.length} de {total}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                loadSalesHistory().catch(() => undefined);
              }}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>{loading ? 'Actualizando...' : 'Actualizar'}</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={onBack}>
              <Text style={styles.primaryButtonText}>Volver al POS</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(8, insets.bottom) },
          ]}
        >
          {loading ? (
            <Text style={styles.stateText}>Cargando ventas...</Text>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : items.length === 0 ? (
            <Text style={styles.stateText}>No hay ventas registradas hoy.</Text>
          ) : (
            items.map((sale) => (
              <View key={sale.id} style={styles.saleCard}>
                <View style={styles.saleHeader}>
                  <View style={styles.saleHeaderMain}>
                    <Text style={styles.saleTitle}>
                      {sale.document_number?.trim() || `Venta #${sale.sale_number ?? sale.id}`}
                    </Text>
                    <Text style={styles.saleMeta}>
                      {formatHistoryDateTime(sale.created_at)} · {sale.vendor_name?.trim() || 'Sin vendedor'}
                    </Text>
                    <Text style={styles.saleMeta}>Método: {resolvePaymentMethodName(sale.payment_method)}</Text>
                    <View style={styles.stationBadge}>
                      <Text style={styles.stationBadgeText}>{sale.pos_name?.trim() || 'POS sin estación'}</Text>
                    </View>
                  </View>
                  <View style={styles.saleHeaderSide}>
                    <Text style={styles.saleAmount}>{formatMoney(sale.total ?? 0)}</Text>
                    <Pressable
                      style={styles.mockButton}
                      onPress={() => {
                        onShowToast('Reimpresión de ticket pendiente de implementación.');
                      }}
                    >
                      <Text style={styles.mockButtonText}>Reimprimir ticket</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.itemsWrap}>
                  {(sale.items ?? []).length === 0 ? (
                    <Text style={styles.itemMeta}>Sin productos en el detalle.</Text>
                  ) : (
                    (sale.items ?? []).map((item, index) => {
                      const quantity = Number(item.quantity ?? 0);
                      const unitPrice = Number(item.unit_price ?? 0);
                      const discount = Number(item.line_discount_value ?? item.discount ?? 0);
                      const lineTotal = Number(item.total ?? quantity * unitPrice);
                      const label = item.product_name?.trim() || 'Producto';
                      return (
                        <View key={`${sale.id}-item-${item.id ?? index}`} style={styles.itemRow}>
                          <View style={styles.itemMain}>
                            <Text style={styles.itemName}>{label}</Text>
                            <Text style={styles.itemMeta}>Cant. {quantity}</Text>
                          </View>
                          <View style={styles.itemSide}>
                            <Text style={styles.itemTotal}>{formatMoney(lineTotal)}</Text>
                            {discount > 0 ? (
                              <Text style={styles.itemDiscount}>Descuento: -{formatMoney(discount)}</Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030918',
  },
  container: {
    flex: 1,
    backgroundColor: '#071325',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
  },
  header: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2f466d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    gap: 12,
  },
  headerMain: {
    gap: 4,
  },
  kicker: {
    color: '#6f85a8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  meta: {
    color: '#8ea3c6',
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  secondaryButton: {
    minWidth: 132,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1e2a42',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButton: {
    minWidth: 132,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#031424',
    fontSize: 16,
    fontWeight: '800',
  },
  list: {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#314a72',
    backgroundColor: '#081224',
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 10,
  },
  stateText: {
    color: '#9bb0ce',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
    paddingHorizontal: 14,
  },
  errorText: {
    color: '#fda4af',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  saleCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#17335c',
    backgroundColor: '#0c1a33',
    overflow: 'hidden',
  },
  saleHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#17335c',
  },
  saleHeaderMain: {
    flex: 1,
  },
  saleTitle: {
    color: '#f4f8ff',
    fontSize: 15,
    fontWeight: '700',
  },
  saleMeta: {
    color: '#8ea3c6',
    fontSize: 12,
    marginTop: 4,
  },
  stationBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d527f',
    backgroundColor: '#102847',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stationBadgeText: {
    color: '#dbe8fb',
    fontSize: 11,
    fontWeight: '700',
  },
  saleHeaderSide: {
    alignItems: 'flex-end',
    gap: 8,
  },
  saleAmount: {
    color: '#67e8b2',
    fontSize: 15,
    fontWeight: '800',
  },
  mockButton: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#35517d',
    backgroundColor: '#142644',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  mockButtonText: {
    color: '#e6f0ff',
    fontSize: 12,
    fontWeight: '700',
  },
  itemsWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
  },
  itemMain: {
    flex: 1,
  },
  itemName: {
    color: '#f4f8ff',
    fontSize: 13,
    fontWeight: '700',
  },
  itemMeta: {
    color: '#8ea3c6',
    fontSize: 12,
    marginTop: 2,
  },
  itemSide: {
    alignItems: 'flex-end',
  },
  itemTotal: {
    color: '#dbe8fb',
    fontSize: 13,
    fontWeight: '700',
  },
  itemDiscount: {
    color: '#67e8b2',
    fontSize: 11,
    marginTop: 2,
  },
});
