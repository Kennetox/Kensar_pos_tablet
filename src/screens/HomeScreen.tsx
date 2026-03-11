import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, type Code, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';

import { useAppSession } from '../contexts/AppSessionContext';
import { APP_VERSION_LABEL } from '../constants/appVersion';
import { PaymentPage, type PaymentLineInput } from '../features/pos/payment/PaymentPage';
import { ApiError, createApiClient } from '../services/api/client';
import {
  fetchCatalogVersion as fetchCatalogVersionApi,
  fetchCatalogProducts,
  fetchProductGroupAppearances,
  type CatalogProduct,
  type ProductGroupAppearance,
} from '../services/api/catalog';
import {
  cancelSaleReservation,
  createSale,
  fetchNextSaleNumber,
  reserveSaleNumber,
} from '../services/api/pos';
import {
  DEFAULT_PAYMENT_METHODS,
  fetchPaymentMethods,
  type PaymentMethodRecord,
} from '../services/api/paymentMethods';
import { SalesHistoryScreen } from './SalesHistoryScreen';
import {
  createPosCustomer,
  fetchPosCustomers,
  type PosCustomerRecord,
} from '../services/api/customers';

type Path = string[];

type GroupAppearance = {
  image_url: string | null;
  image_thumb_url: string | null;
  tile_color: string | null;
};

type CustomerFormState = {
  name: string;
  phone: string;
  email: string;
  taxId: string;
  address: string;
};

type StructuredProduct = {
  product: CatalogProduct;
  path: Path | null;
  isService: boolean;
};

type CartItem = {
  id: number;
  product: CatalogProduct;
  quantity: number;
  unitPrice: number;
  lineDiscountValue: number;
  lineDiscountIsPercent: boolean;
  lineDiscountPercent: number;
  freeSaleReason?: string;
};

type GridTile =
  | { type: 'back'; id: string; label: string }
  | { type: 'group'; id: string; label: string; path: Path; imageUrl?: string | null; color?: string | null }
  | { type: 'product'; id: string; product: CatalogProduct };

type DiscountScope = 'item' | 'cart';
type DiscountMode = 'value' | 'percent';
type PaymentView = 'none' | 'single' | 'multiple';
type PaymentLine = PaymentLineInput;
type SurchargeMethod = 'addi' | 'sistecredito' | 'manual' | null;
type SurchargeState = {
  method: SurchargeMethod;
  amount: number;
  enabled: boolean;
  isManual: boolean;
};

type SuccessSaleSummary = {
  saleId: number;
  documentNumber: string;
  saleNumber: number;
  total: number;
  subtotal: number;
  lineDiscountTotal: number;
  cartDiscountLabel: string;
  cartDiscountValueDisplay: string;
  surchargeLabel?: string;
  surchargeValueDisplay?: string;
  notes?: string;
  changeAmount: number;
  showChange: boolean;
  payments: { label: string; amount: number }[];
  customer?: {
    name: string;
    phone?: string;
    email?: string;
    taxId?: string;
    address?: string;
  };
};

const QUICK_ACTIONS = [
  { label: 'Eliminar', tone: 'danger' as const },
  { label: 'Cantidad', tone: 'neutral' as const },
  { label: 'Descuento', tone: 'neutral' as const },
  { label: 'Cliente', tone: 'accent' as const },
];

const PAGE_SIZE = 16;
const CUSTOMER_PAGE_SIZE = 12;
const DEFAULT_CART_WIDTH = 460;
const MIN_CART_WIDTH = 280;
const MAX_CART_WIDTH = 460;
const DEFAULT_GRID_ZOOM = 1;
const MIN_GRID_ZOOM = 0.68;
const MAX_GRID_ZOOM = 1;
const REQUIRE_FREE_SALE_REASON = true;
const FREE_SALE_NAME_MATCH = 'venta libre';

const SURCHARGE_PRESET_RATES: Record<Exclude<SurchargeMethod, null>, number> = {
  addi: 0.1,
  sistecredito: 0.05,
  manual: 0,
};

const SYNC_COLORS = {
  online: '#0A8F5A',
  checking: '#0EA5E9',
  degraded: '#F59E0B',
  offline: '#DC2626',
} as const;

const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  name: '',
  phone: '',
  email: '',
  taxId: '',
  address: '',
};

function splitGroupPath(groupName: string | null): string[] | null {
  if (!groupName) {
    return null;
  }

  const parts = groupName
    .split(/>|\/+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length ? parts : null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPriceInputValue(rawValue: string): string {
  if (!rawValue) {
    return '';
  }
  const digitsOnly = rawValue.replace(/\D/g, '');
  if (!digitsOnly) {
    return '';
  }
  const normalized = digitsOnly.replace(/^0+(?=\d)/, '') || (digitsOnly ? '0' : '');
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function calcLineTotal(item: CartItem): number {
  const gross = item.quantity * item.unitPrice;
  return Math.max(0, gross - item.lineDiscountValue);
}

function slugifyMethodKey(value?: string | null): string {
  if (!value) {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isFreeSaleProduct(product: CatalogProduct): boolean {
  const normalizedName = slugifyMethodKey(product.name);
  if (normalizedName === slugifyMethodKey(FREE_SALE_NAME_MATCH) || normalizedName.includes(slugifyMethodKey(FREE_SALE_NAME_MATCH))) {
    return true;
  }
  const normalizedSku = slugifyMethodKey(product.sku);
  return normalizedSku.includes('venta-libre');
}

function roundUpToThousand(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.ceil(value / 1000) * 1000;
}

function getSurchargeMethodLabel(method: SurchargeMethod) {
  switch (method) {
    case 'addi':
      return 'Addi';
    case 'sistecredito':
      return 'Sistecrédito';
    case 'manual':
      return 'Manual';
    default:
      return 'Incremento';
  }
}

function getSyncMeta(status: 'checking' | 'online' | 'degraded' | 'offline') {
  if (status === 'online') return { label: 'Conectado y sincronizado', color: SYNC_COLORS.online };
  if (status === 'degraded') return { label: 'Sesión o sync con advertencia', color: SYNC_COLORS.degraded };
  if (status === 'offline') return { label: 'Sin conexión con API', color: SYNC_COLORS.offline };
  return { label: 'Validando conexión', color: SYNC_COLORS.checking };
}

function formatSyncDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildCatalogVersionKey(payload?: {
  updated_at?: string | null;
  products_count?: number | null;
  groups_count?: number | null;
}) {
  const updatedAtKey = payload?.updated_at ?? '';
  const countsKey = `${payload?.products_count ?? ''}:${payload?.groups_count ?? ''}`;
  if (!updatedAtKey && countsKey === ':') {
    return null;
  }
  return `${updatedAtKey}|${countsKey}`;
}

function normalizeBarcode(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

function getPaymentBlockedReason(params: {
  paymentSubmitting: boolean;
  paymentView: PaymentView;
  cartTotal: number;
  allowsChange: boolean;
  paymentSinglePaid: number;
  paymentMultipleTotal: number;
  paymentMultipleRemaining: number;
}): string | null {
  const {
    paymentSubmitting,
    paymentView,
    cartTotal,
    allowsChange,
    paymentSinglePaid,
    paymentMultipleTotal,
    paymentMultipleRemaining,
  } = params;
  if (paymentSubmitting) {
    return 'Estamos procesando una operación. Intenta nuevamente en unos segundos.';
  }
  if (paymentView === 'single') {
    if (cartTotal <= 0) {
      return 'El total de la venta debe ser mayor a cero.';
    }
    if (allowsChange && paymentSinglePaid < cartTotal) {
      return 'El monto recibido no puede ser menor al total.';
    }
    return null;
  }
  if (paymentMultipleTotal <= 0) {
    return 'Agrega montos en las líneas de pago para continuar.';
  }
  if (paymentMultipleRemaining > 0) {
    return `Faltan ${formatMoney(paymentMultipleRemaining)} para completar el pago.`;
  }
  return null;
}

function DismissKeyboardOverlay({
  behavior,
  keyboardVerticalOffset,
  keyboardHeight,
  children,
}: {
  behavior: 'height' | 'padding' | 'position';
  keyboardVerticalOffset: number;
  keyboardHeight?: number;
  children: React.ReactNode;
}) {
  const safeKeyboardHeight = Math.max(0, keyboardHeight ?? 0);
  const overlayBottomPad =
    Platform.OS === 'ios' && safeKeyboardHeight > 0 ? Math.min(safeKeyboardHeight, 260) + 12 : 18;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={[styles.quantityOverlay, { paddingBottom: overlayBottomPad }]}
        behavior={behavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <TouchableWithoutFeedback onPress={() => undefined} accessible={false}>
          <View
            style={[
              styles.quantityOverlayContent,
              safeKeyboardHeight > 0 && Platform.OS === 'ios' ? styles.quantityOverlayContentKeyboard : null,
            ]}
          >
            {children}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const modalKeyboardBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
  const modalKeyboardOffset = Platform.OS === 'ios' ? 24 : 0;
  const freeSaleModalKeyboardBehavior: 'height' | 'padding' | 'position' = Platform.OS === 'ios' ? 'padding' : 'height';
  const freeSaleModalKeyboardOffset = Platform.OS === 'ios' ? 24 : 0;
  const {
    user,
    stationId,
    stationLabel,
    parentStationLabel,
    apiBase,
    token,
    logout,
    expireSession,
    syncStatus,
    syncReason,
    lastSyncAt,
    lastSyncCheckAt,
    refreshSyncStatus,
  } = useAppSession();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [groupAppearances, setGroupAppearances] = useState<Record<string, GroupAppearance>>({});
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<Path>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [gridZoom, setGridZoom] = useState(DEFAULT_GRID_ZOOM);
  const [cartWidth, setCartWidth] = useState(DEFAULT_CART_WIDTH);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [catalogViewport, setCatalogViewport] = useState({ width: 0, height: 0 });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCartId, setSelectedCartId] = useState<number | null>(null);
  const [quantityModalOpen, setQuantityModalOpen] = useState(false);
  const [quantityValue, setQuantityValue] = useState('1');
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountScope, setDiscountScope] = useState<DiscountScope>('item');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('value');
  const [discountInput, setDiscountInput] = useState('');
  const [cartDiscountValue, setCartDiscountValue] = useState(0);
  const [cartDiscountPercent, setCartDiscountPercent] = useState(0);
  const [cartSurcharge, setCartSurcharge] = useState<SurchargeState>({
    method: null,
    amount: 0,
    enabled: false,
    isManual: false,
  });
  const [surchargeModalOpen, setSurchargeModalOpen] = useState(false);
  const [customSurchargeValue, setCustomSurchargeValue] = useState('');
  const [customSurchargePercent, setCustomSurchargePercent] = useState('5');
  const [paymentView, setPaymentView] = useState<PaymentView>('none');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [saleNotes, setSaleNotes] = useState('');
  const [paymentCatalog, setPaymentCatalog] = useState<PaymentMethodRecord[]>(DEFAULT_PAYMENT_METHODS);
  const [separatedPaymentMethod, setSeparatedPaymentMethod] = useState<string | null>(null);
  const [paymentValue, setPaymentValue] = useState('0');
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [selectedPaymentLineId, setSelectedPaymentLineId] = useState<number | null>(null);
  const [paymentLineInput, setPaymentLineInput] = useState('0');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [successSale, setSuccessSale] = useState<SuccessSaleSummary | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomerRecord | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerMode, setCustomerMode] = useState<'list' | 'new'>('list');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<PosCustomerRecord[]>([]);
  const [customerPage, setCustomerPage] = useState(0);
  const [customerHasMore, setCustomerHasMore] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerListReady, setCustomerListReady] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);
  const [pendingCustomerSelection, setPendingCustomerSelection] = useState<PosCustomerRecord | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [actionToastTone, setActionToastTone] = useState<'info' | 'error'>('info');
  const [actionToastVisible, setActionToastVisible] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState<string | null>(null);
  const [catalogUpdateAvailable, setCatalogUpdateAvailable] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [refreshingSync, setRefreshingSync] = useState(false);
  const [bogotaTimeLabel, setBogotaTimeLabel] = useState('');
  const [historyPageOpen, setHistoryPageOpen] = useState(false);
  const [freeSaleReasonModalOpen, setFreeSaleReasonModalOpen] = useState(false);
  const [freeSaleReasonTargetCartId, setFreeSaleReasonTargetCartId] = useState<number | null>(null);
  const [freeSaleReasonProduct, setFreeSaleReasonProduct] = useState<CatalogProduct | null>(null);
  const [freeSaleReasonValue, setFreeSaleReasonValue] = useState('');
  const [pendingFreeSaleReason, setPendingFreeSaleReason] = useState<string | null>(null);
  const [priceChangeProduct, setPriceChangeProduct] = useState<CatalogProduct | null>(null);
  const [priceChangeValue, setPriceChangeValue] = useState('0');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [currentSaleNumber, setCurrentSaleNumber] = useState<number | null>(null);
  const [reservedSaleId, setReservedSaleId] = useState<number | null>(null);
  const [reservedSaleNumber, setReservedSaleNumber] = useState<number | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const catalogPagerRef = useRef<FlatList<GridTile[]> | null>(null);
  const isCatalogPagerProgrammaticRef = useRef(false);
  const scannerCooldownRef = useRef(0);
  const catalogVersionRef = useRef<string | null>(null);
  const catalogUpdateAvailableRef = useRef(false);
  const cartWidthRef = useRef(DEFAULT_CART_WIDTH);
  const dragStartWidthRef = useRef(DEFAULT_CART_WIDTH);
  const lastDividerTapRef = useRef(0);
  const toastTimersRef = useRef<{
    hide?: ReturnType<typeof setTimeout>;
  }>({});
  const layoutStorageKey = useMemo(
    () => `@kensar_pos_tablet/layout/${stationId?.trim() || 'default'}`,
    [stationId],
  );
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const cameraDevice = useCameraDevice('back');

  const apiClient = useMemo(
    () =>
      createApiClient({
        getBaseUrl: () => apiBase,
        getToken: () => token,
        onUnauthorized: expireSession,
      }),
    [apiBase, expireSession, token],
  );

  const resolvedPosName = useMemo(() => {
    const label = stationLabel?.trim();
    return label ? `POS ${label}` : 'POS Tablet';
  }, [stationLabel]);
  const syncMeta = useMemo(() => getSyncMeta(syncStatus), [syncStatus]);
  const lastSyncText = useMemo(
    () => (lastSyncAt ? formatSyncDateTime(lastSyncAt) : 'Sin sincronización confirmada'),
    [lastSyncAt],
  );
  const lastCheckText = useMemo(
    () => (lastSyncCheckAt ? formatSyncDateTime(lastSyncCheckAt) : 'Sin chequeo aún'),
    [lastSyncCheckAt],
  );
  const modalCompact = false;

  useEffect(() => {
    catalogVersionRef.current = catalogVersion;
  }, [catalogVersion]);

  useEffect(() => {
    catalogUpdateAvailableRef.current = catalogUpdateAvailable;
  }, [catalogUpdateAvailable]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = event.endCoordinates?.height ?? 0;
      setKeyboardHeight(Math.max(0, nextHeight));
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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


  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const methods = await fetchPaymentMethods(apiClient);
        if (!active) {
          return;
        }
        setPaymentCatalog(methods.length ? methods : DEFAULT_PAYMENT_METHODS);
      } catch {
        if (!active) {
          return;
        }
        setPaymentCatalog(DEFAULT_PAYMENT_METHODS);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (!customerModalOpen || customerMode !== 'list') {
      return;
    }
    let active = true;
    setCustomerLoading(true);
    const timer = setTimeout(() => {
      setCustomerError(null);
      fetchPosCustomers(apiClient, {
        search: customerSearch.trim(),
        skip: customerPage * CUSTOMER_PAGE_SIZE,
        limit: CUSTOMER_PAGE_SIZE,
      })
        .then((customers) => {
          if (!active) {
            return;
          }
          setCustomerResults(customers);
          setCustomerHasMore(customers.length === CUSTOMER_PAGE_SIZE);
          setCustomerListReady(true);
        })
        .catch((err) => {
          if (!active) {
            return;
          }
          setCustomerError(err instanceof Error ? err.message : 'No se pudieron cargar los clientes.');
          setCustomerResults([]);
          setCustomerHasMore(false);
          setCustomerListReady(true);
        })
        .finally(() => {
          if (active) {
            setCustomerLoading(false);
          }
        });
    }, 260);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apiClient, customerModalOpen, customerMode, customerPage, customerSearch]);

  const refreshNextSaleNumber = useCallback(async () => {
    const payload = await fetchNextSaleNumber(apiClient);
    const next = Number(payload.next_sale_number);
    if (Number.isFinite(next) && next > 0) {
      setCurrentSaleNumber(next);
      return next;
    }
    throw new Error('No se pudo leer el siguiente consecutivo de venta.');
  }, [apiClient]);

  const releaseReservation = useCallback(
    async (reservationId: number | null) => {
      if (!reservationId) {
        return;
      }
      try {
        await cancelSaleReservation(apiClient, reservationId);
      } catch {
        // noop
      }
    },
    [apiClient],
  );

  const ensureSaleReservation = useCallback(async () => {
    if (reservedSaleId && reservedSaleNumber) {
      return {
        reservationId: reservedSaleId,
        saleNumber: reservedSaleNumber,
      };
    }

    const reservation = await reserveSaleNumber(apiClient, {
      pos_name: resolvedPosName,
      station_id: stationId.trim() || undefined,
      min_sale_number: currentSaleNumber ?? undefined,
    });

    setReservedSaleId(reservation.reservation_id);
    setReservedSaleNumber(reservation.sale_number);
    setCurrentSaleNumber(reservation.sale_number);

    return {
      reservationId: reservation.reservation_id,
      saleNumber: reservation.sale_number,
    };
  }, [apiClient, currentSaleNumber, reservedSaleId, reservedSaleNumber, resolvedPosName, stationId]);

  const loadProducts = useCallback(async (): Promise<boolean> => {
    try {
      const catalogProducts = await fetchCatalogProducts(apiClient);
      setProducts(catalogProducts.filter((product) => product.active));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el catalogo.');
      return false;
    }
  }, [apiClient]);

  const loadGroupAppearances = useCallback(async (): Promise<boolean> => {
    try {
      const productGroups = await fetchProductGroupAppearances(apiClient);
      const appearanceMap: Record<string, GroupAppearance> = {};
      productGroups.forEach((group: ProductGroupAppearance) => {
        if (group.path) {
          appearanceMap[group.path] = {
            image_url: group.image_url,
            image_thumb_url: group.image_thumb_url,
            tile_color: group.tile_color,
          };
        }
      });
      setGroupAppearances(appearanceMap);
      return true;
    } catch (err) {
      console.warn('No se pudieron cargar grupos de catalogo', err);
      return false;
    }
  }, [apiClient]);

  const checkCatalogVersion = useCallback(
    async (options?: { silent?: boolean; markSynced?: boolean }) => {
      if (!token) {
        return null;
      }
      try {
        const payload = await fetchCatalogVersionApi(apiClient);
        const nextVersion = buildCatalogVersionKey(payload);
        if (options?.markSynced) {
          setCatalogVersion(nextVersion);
          setCatalogUpdateAvailable(false);
          return nextVersion;
        }
        const previousVersion = catalogVersionRef.current;
        if (previousVersion == null && nextVersion != null) {
          setCatalogVersion(nextVersion);
          return nextVersion;
        }
        if (previousVersion != null && nextVersion != null && nextVersion !== previousVersion) {
          if (!catalogUpdateAvailableRef.current) {
            setCatalogUpdateAvailable(true);
          }
        }
        return nextVersion;
      } catch (err) {
        if (!options?.silent) {
          console.warn('No se pudo verificar la version de catalogo', err);
        }
        return null;
      }
    },
    [apiClient, token],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [productsOk, groupsOk] = await Promise.all([
          loadProducts(),
          loadGroupAppearances(),
        ]);
        if (!active) return;
        if (productsOk && groupsOk) {
          await checkCatalogVersion({ silent: true, markSynced: true });
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el catalogo.');
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [checkCatalogVersion, loadGroupAppearances, loadProducts]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let active = true;
    (async () => {
      if (!active) return;
      await checkCatalogVersion({ silent: true, markSynced: true });
    })();
    return () => {
      active = false;
    };
  }, [checkCatalogVersion, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    checkCatalogVersion({ silent: true }).catch(() => undefined);
    const interval = setInterval(() => {
      checkCatalogVersion({ silent: true }).catch(() => undefined);
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkCatalogVersion, token]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const next = await refreshNextSaleNumber();
        if (!active) {
          return;
        }
        setCurrentSaleNumber(next);
      } catch {
        if (!active) {
          return;
        }
        setCurrentSaleNumber(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshNextSaleNumber]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(layoutStorageKey);
        if (!active || !raw) {
          return;
        }

        const persisted = JSON.parse(raw) as {
          cartWidth?: number;
          gridZoom?: number;
        };

        if (typeof persisted.cartWidth === 'number') {
          const nextWidth = Math.max(MIN_CART_WIDTH, Math.min(MAX_CART_WIDTH, persisted.cartWidth));
          cartWidthRef.current = nextWidth;
          setCartWidth(nextWidth);
        }

        if (typeof persisted.gridZoom === 'number') {
          setGridZoom(Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, persisted.gridZoom)));
        }
      } catch {
        // noop
      }
    })();

    return () => {
      active = false;
    };
  }, [layoutStorageKey]);

  useEffect(() => {
    AsyncStorage.setItem(
      layoutStorageKey,
      JSON.stringify({
        cartWidth,
        gridZoom,
      }),
    ).catch(() => undefined);
  }, [cartWidth, gridZoom, layoutStorageKey]);

  useEffect(() => {
    cartWidthRef.current = cartWidth;
  }, [cartWidth]);

  useEffect(() => {
    if (!userMenuVisible) {
      return;
    }

    Animated.timing(slideAnim, {
      toValue: userMenuOpen ? 1 : 0,
      duration: userMenuOpen ? 180 : 150,
      easing: userMenuOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !userMenuOpen) {
        setUserMenuVisible(false);
      }
    });
  }, [slideAnim, userMenuOpen, userMenuVisible]);

  useEffect(() => {
    Animated.timing(toastAnim, {
      toValue: actionToastVisible ? 1 : 0,
      duration: actionToastVisible ? 180 : 150,
      easing: actionToastVisible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !actionToastVisible) {
        setActionToast(null);
      }
    });
  }, [actionToastVisible, toastAnim]);

  useEffect(
    () => () => {
      if (toastTimersRef.current.hide) {
        clearTimeout(toastTimersRef.current.hide);
      }
    },
    [],
  );

  const showActionToast = useCallback((message: string, duration = 2600, tone: 'info' | 'error' = 'info') => {
    if (toastTimersRef.current.hide) {
      clearTimeout(toastTimersRef.current.hide);
    }
    setActionToast(message);
    setActionToastTone(tone);
    setActionToastVisible(true);
    toastTimersRef.current.hide = setTimeout(() => {
      setActionToastVisible(false);
    }, duration);
  }, []);

  const handleRefreshSync = useCallback(async () => {
    setRefreshingSync(true);
    try {
      await refreshSyncStatus();
    } finally {
      setRefreshingSync(false);
    }
  }, [refreshSyncStatus]);

  const handleManualSync = useCallback(async () => {
    if (!token) {
      showActionToast('Debes iniciar sesion para sincronizar.', 2600, 'error');
      return;
    }
    if (syncingCatalog) {
      return;
    }
    setSyncingCatalog(true);
    try {
      const [productsOk, groupsOk] = await Promise.all([loadProducts(), loadGroupAppearances()]);
      if (productsOk && groupsOk) {
        await checkCatalogVersion({ silent: true, markSynced: true });
        showActionToast('Catalogo sincronizado.');
      } else {
        showActionToast('No se pudo sincronizar. Intenta nuevamente.', 2600, 'error');
      }
    } finally {
      setSyncingCatalog(false);
    }
  }, [checkCatalogVersion, loadGroupAppearances, loadProducts, showActionToast, syncingCatalog, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    handleRefreshSync().catch(() => undefined);
  }, [handleRefreshSync, token]);

  const openUserMenu = useCallback(() => {
    setUserMenuVisible(true);
    setUserMenuOpen(true);
  }, []);

  const closeUserMenu = useCallback(() => {
    setUserMenuOpen(false);
  }, []);

  const handleOpenScanner = useCallback(async () => {
    if (!cameraDevice) {
      showActionToast('No encontramos cámara disponible en este equipo.', 2600, 'error');
      return;
    }
    if (!hasCameraPermission) {
      const granted = await requestCameraPermission();
      if (!granted) {
        showActionToast('Debes permitir el acceso a cámara para escanear códigos.', 2600, 'error');
        return;
      }
    }
    scannerCooldownRef.current = 0;
    setScannerOpen(true);
  }, [cameraDevice, hasCameraPermission, requestCameraPermission, showActionToast]);

  const openHistoryPage = useCallback(() => {
    setUserMenuOpen(false);
    setUserMenuVisible(false);
    slideAnim.setValue(0);
    setHistoryPageOpen(true);
  }, [slideAnim]);

  const resolveAssetUrl = useCallback(
    (url?: string | null) => {
      if (!url) {
        return null;
      }

      try {
        return new URL(url, apiBase).toString();
      } catch {
        return null;
      }
    },
    [apiBase],
  );

  const structuredProducts = useMemo<StructuredProduct[]>(
    () =>
      products.map((product) => ({
        product,
        path: splitGroupPath(product.group_name),
        isService:
          (!product.group_name || !product.group_name.trim()) &&
          (product.service || product.allow_price_change),
      })),
    [products],
  );

  const filteredBySearch = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return structuredProducts;
    }

    return structuredProducts.filter(({ product }) => {
      const haystack = `${product.name ?? ''} ${product.sku ?? ''} ${product.barcode ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, structuredProducts]);

  const getGroupImageForPath = useCallback(
    (path: Path) => {
      const key = path.join('/');
      const meta = groupAppearances[key];
      return resolveAssetUrl(meta?.image_thumb_url ?? meta?.image_url ?? null);
    },
    [groupAppearances, resolveAssetUrl],
  );

  const getGroupColorForPath = useCallback(
    (path: Path) => {
      const key = path.join('/');
      return groupAppearances[key]?.tile_color ?? null;
    },
    [groupAppearances],
  );

  const tiles = useMemo<GridTile[]>(() => {
    const nextTiles: GridTile[] = [];
    const inSearch = search.trim().length > 0;

    if (inSearch) {
      filteredBySearch.forEach(({ product }) => {
        nextTiles.push({
          type: 'product',
          id: `p-${product.id}`,
          product,
        });
      });
      return nextTiles;
    }

    if (currentPath.length === 0) {
      const rootGroups = new Set<string>();

      filteredBySearch.forEach(({ path, isService }) => {
        if (isService) {
          return;
        }
        if (path && path.length > 0) {
          rootGroups.add(path[0]);
        }
      });

      Array.from(rootGroups)
        .sort((a, b) => a.localeCompare(b))
        .forEach((groupName) => {
          nextTiles.push({
            type: 'group',
            id: `g-${groupName}`,
            label: groupName,
            path: [groupName],
            imageUrl: getGroupImageForPath([groupName]),
            color: getGroupColorForPath([groupName]),
          });
        });

      filteredBySearch.forEach(({ product, isService, path }) => {
        if (path && path.length > 0) {
          return;
        }
        if (!isService) {
          return;
        }
        nextTiles.push({
          type: 'product',
          id: `p-${product.id}`,
          product,
        });
      });

      return nextTiles;
    }

    nextTiles.push({ type: 'back', id: 'back', label: 'Volver' });

    const subGroupSet = new Set<string>();
    const productTiles: GridTile[] = [];

    filteredBySearch.forEach(({ product, path }) => {
      if (!path || path.length === 0) {
        return;
      }

      const matches =
        path.length >= currentPath.length &&
        currentPath.every((segment, index) => segment === path[index]);

      if (!matches) {
        return;
      }

      if (path.length === currentPath.length) {
        productTiles.push({
          type: 'product',
          id: `p-${product.id}`,
          product,
        });
      } else {
        subGroupSet.add(path[currentPath.length]);
      }
    });

    Array.from(subGroupSet)
      .sort((a, b) => a.localeCompare(b))
      .forEach((subGroup) => {
        const subPath = [...currentPath, subGroup];
        nextTiles.push({
          type: 'group',
          id: `sg-${subPath.join('/')}`,
          label: subGroup,
          path: subPath,
          imageUrl: getGroupImageForPath(subPath),
          color: getGroupColorForPath(subPath),
        });
      });

    productTiles.sort((a, b) => {
      if (a.type !== 'product' || b.type !== 'product') {
        return 0;
      }
      return a.product.name.localeCompare(b.product.name);
    });

    nextTiles.push(...productTiles);
    return nextTiles;
  }, [currentPath, filteredBySearch, getGroupColorForPath, getGroupImageForPath, search]);

  const totalPages = Math.max(1, Math.ceil(tiles.length / PAGE_SIZE));
  const shouldPaginate = currentPath.length > 0 || search.trim().length > 0;
  const safePage = shouldPaginate ? Math.min(currentPage, totalPages) : 1;
  const catalogPageWidth = Math.max(320, catalogViewport.width - 24);
  const pagedTiles = useMemo(
    () =>
      shouldPaginate
        ? Array.from({ length: totalPages }, (_, index) =>
            tiles.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
          )
        : [tiles],
    [shouldPaginate, tiles, totalPages],
  );
  const pageTiles = useMemo(
    () => (shouldPaginate ? pagedTiles[safePage - 1] ?? [] : tiles),
    [pagedTiles, safePage, shouldPaginate, tiles],
  );

  const handleCatalogLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCatalogViewport((current) => {
      if (current.width === width && current.height === height) {
        return current;
      }
      return { width, height };
    });
  }, []);

  const handleBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setBodyWidth((current) => (current === width ? current : width));
  }, []);

  const gridMetrics = useMemo(() => {
    const zoomRatio = (gridZoom - MIN_GRID_ZOOM) / (MAX_GRID_ZOOM - MIN_GRID_ZOOM);
    const gap = Math.round(10 + zoomRatio * 8);
    const horizontalPadding = Math.round(20 + zoomRatio * 8);
    const verticalPadding = 24;
    const availableWidth = Math.max(0, catalogViewport.width - horizontalPadding);
    const baseColumns =
      availableWidth >= 980 ? 6
      : availableWidth >= 820 ? 5
      : availableWidth >= 620 ? 4
      : 3;
    const zoomColumnDelta = zoomRatio < 0.3 ? 1 : zoomRatio > 0.88 ? -1 : 0;
    let columns = Math.max(3, Math.min(6, baseColumns + zoomColumnDelta));
    if (availableWidth >= 620) {
      columns = Math.max(4, columns);
    }
    const baseWidth = catalogViewport.width > 0
      ? Math.floor((availableWidth - gap * (columns - 1)) / columns)
      : columns >= 5
        ? 148
        : columns === 4
          ? 176
          : 220;
    const baseHeight = catalogViewport.height > 0
      ? Math.floor((catalogViewport.height - verticalPadding - gap * 3) / 4)
      : 156;

    // Keep columns stretched edge-to-edge and let zoom influence both density and card size.
    const tileWidth = Math.max(columns >= 5 ? 128 : columns === 4 ? 132 : 160, baseWidth);
    const zoomHeightScale = 0.84 + zoomRatio * 0.3;
    const scaledHeight = Math.round(baseHeight * zoomHeightScale);
    const tileHeight = Math.max(112, Math.min(baseHeight, scaledHeight));
    const imageHeight = Math.max(42, Math.round(Math.min(tileHeight * 0.46, tileWidth * 0.48)));
    const labelFontSize = tileHeight < 126 ? 12 : tileHeight < 144 ? 13 : 16;
    const priceFontSize = tileHeight < 126 ? 11 : tileHeight < 144 ? 12 : 14;
    const tilePadding = Math.max(10, Math.round(tileHeight * 0.1));
    const imageWidth = Math.max(76, Math.round(tileWidth * 0.62));

    return {
      columns,
      gap,
      tileWidth,
      tileHeight,
      imageHeight,
      imageWidth,
      labelFontSize,
      priceFontSize,
      tilePadding,
    };
  }, [catalogViewport.height, catalogViewport.width, gridZoom]);
  const goToCatalogPage = useCallback(
    (targetPage: number, animated = true) => {
      if (!shouldPaginate) {
        return;
      }
      const nextPage = Math.max(1, Math.min(totalPages, targetPage));
      setCurrentPage(nextPage);
      const list = catalogPagerRef.current;
      if (!list) {
        return;
      }
      isCatalogPagerProgrammaticRef.current = true;
      requestAnimationFrame(() => {
        list.scrollToIndex({ index: nextPage - 1, animated });
      });
    },
    [shouldPaginate, totalPages],
  );

  const handleCatalogPagerMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!shouldPaginate) {
        return;
      }
      const width = event.nativeEvent.layoutMeasurement.width;
      if (width <= 0) {
        return;
      }
      const page = Math.max(1, Math.min(totalPages, Math.round(event.nativeEvent.contentOffset.x / width) + 1));
      setCurrentPage(page);
      isCatalogPagerProgrammaticRef.current = false;
    },
    [shouldPaginate, totalPages],
  );

  const handleCatalogPagerScrollToIndexFailed = useCallback(
    (info: { averageItemLength: number; index: number }) => {
      const list = catalogPagerRef.current;
      if (!list) {
        return;
      }
      const estimatedOffset = info.averageItemLength > 0 ? info.averageItemLength * info.index : catalogPageWidth * info.index;
      list.scrollToOffset({ offset: estimatedOffset, animated: false });
    },
    [catalogPageWidth],
  );

  const dividerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 3,
        onPanResponderGrant: () => {
          dragStartWidthRef.current = cartWidthRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          if (!bodyWidth) {
            return;
          }

          const dragDelta = gestureState.dx * 0.65;
          const nextWidth = Math.max(
            MIN_CART_WIDTH,
            Math.min(bodyWidth - 520, dragStartWidthRef.current + dragDelta),
          );
          setCartWidth(nextWidth);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (!bodyWidth) {
            return;
          }

          const dragDelta = gestureState.dx * 0.65;
          const nextWidth = Math.max(
            MIN_CART_WIDTH,
            Math.min(bodyWidth - 520, dragStartWidthRef.current + dragDelta),
          );
          cartWidthRef.current = nextWidth;
          dragStartWidthRef.current = nextWidth;
          setCartWidth(nextWidth);
        },
        onPanResponderTerminate: () => {
          dragStartWidthRef.current = cartWidthRef.current;
        },
      }),
    [bodyWidth],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [currentPath, search]);

  useEffect(() => {
    if (!shouldPaginate) {
      return;
    }
    const list = catalogPagerRef.current;
    if (!list) {
      return;
    }
    if (isCatalogPagerProgrammaticRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      list.scrollToIndex({ index: safePage - 1, animated: false });
    });
  }, [safePage, shouldPaginate]);

  const userInitials = useMemo(() => {
    const name = user?.name?.trim();
    if (!name) {
      return 'U';
    }
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((chunk) => chunk.charAt(0).toUpperCase())
      .join('');
  }, [user?.name]);

  const cartGrossSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [cart],
  );

  const cartLineDiscountTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.lineDiscountValue, 0),
    [cart],
  );

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + calcLineTotal(item), 0),
    [cart],
  );

  const discountFromPercent = useMemo(
    () => cartSubtotal * (cartDiscountPercent / 100),
    [cartSubtotal, cartDiscountPercent],
  );

  const cartTotalBeforeSurcharge = useMemo(
    () => Math.max(0, cartSubtotal - cartDiscountValue - discountFromPercent),
    [cartDiscountValue, cartSubtotal, discountFromPercent],
  );
  const cartTotal = useMemo(
    () => cartTotalBeforeSurcharge + (cartSurcharge.enabled ? cartSurcharge.amount : 0),
    [cartSurcharge.amount, cartSurcharge.enabled, cartTotalBeforeSurcharge],
  );
  const freeSaleReasons = useMemo(
    () =>
      cart
        .filter((item) => isFreeSaleProduct(item.product))
        .map((item) => item.freeSaleReason?.trim() ?? '')
        .filter((reason) => reason.length > 0),
    [cart],
  );
  const missingFreeSaleReason = useMemo(
    () =>
      REQUIRE_FREE_SALE_REASON &&
      cart.some((item) => isFreeSaleProduct(item.product) && !item.freeSaleReason?.trim()),
    [cart],
  );
  const canProceedToPayment = cart.length > 0 && !missingFreeSaleReason;
  const creditMethodSlugs = useMemo(() => new Set(['credito', 'separado']), []);
  const activePaymentMethods = useMemo(
    () =>
      [...paymentCatalog]
        .filter((method) => method.is_active)
        .sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name)),
    [paymentCatalog],
  );
  const selectedPaymentMethod = useMemo(
    () => activePaymentMethods.find((method) => method.slug === paymentMethod) ?? null,
    [activePaymentMethods, paymentMethod],
  );
  const separatedMethodOptions = useMemo(
    () => activePaymentMethods.filter((method) => !creditMethodSlugs.has(method.slug)),
    [activePaymentMethods, creditMethodSlugs],
  );
  const allowsChange = selectedPaymentMethod?.allow_change ?? false;
  const isCreditLike = creditMethodSlugs.has(paymentMethod);
  const requiresManualAmount = allowsChange || isCreditLike;
  const paymentAmountNumber = useMemo(
    () => Number(paymentValue.replace(/[^\d]/g, '')) || 0,
    [paymentValue],
  );
  const selectedPaymentLine = useMemo(
    () => paymentLines.find((line) => line.id === selectedPaymentLineId) ?? null,
    [paymentLines, selectedPaymentLineId],
  );
  const paymentMultipleTotal = useMemo(
    () => paymentLines.reduce((sum, line) => sum + line.amount, 0),
    [paymentLines],
  );
  const paymentMultipleDiff = useMemo(() => paymentMultipleTotal - cartTotal, [paymentMultipleTotal, cartTotal]);
  const paymentMultipleChange = useMemo(() => Math.max(0, paymentMultipleDiff), [paymentMultipleDiff]);
  const paymentMultipleRemaining = useMemo(() => Math.max(0, -paymentMultipleDiff), [paymentMultipleDiff]);
  const paymentMultipleBadgeLabel = useMemo(() => {
    if (paymentMultipleDiff > 0) {
      return 'Cambio';
    }
    if (paymentMultipleDiff === 0) {
      return 'Listo';
    }
    return 'Restante';
  }, [paymentMultipleDiff]);
  const paymentMultipleBadgeAmount = useMemo(
    () => (paymentMultipleDiff > 0 ? paymentMultipleDiff : Math.abs(paymentMultipleDiff)),
    [paymentMultipleDiff],
  );
  const paymentSinglePaid = useMemo(() => {
    if (isCreditLike) {
      return paymentAmountNumber;
    }
    if (allowsChange) {
      return paymentAmountNumber;
    }
    return cartTotal;
  }, [allowsChange, cartTotal, isCreditLike, paymentAmountNumber]);
  const paymentSingleChange = useMemo(() => {
    if (isCreditLike) {
      return 0;
    }
    if (allowsChange) {
      return Math.max(0, paymentSinglePaid - cartTotal);
    }
    return 0;
  }, [allowsChange, cartTotal, isCreditLike, paymentSinglePaid]);
  const singleDisplayLabel = useMemo(() => {
    if (isCreditLike) {
      return 'Saldo pendiente';
    }
    return 'Cambio';
  }, [isCreditLike]);
  const singleDisplayAmount = useMemo(() => {
    if (isCreditLike) {
      return Math.max(0, cartTotal - paymentSinglePaid);
    }
    if (allowsChange) {
      return paymentSinglePaid - cartTotal;
    }
    return 0;
  }, [allowsChange, cartTotal, isCreditLike, paymentSinglePaid]);
  const paymentSingleConfirmDisabled = useMemo(() => {
    if (paymentSubmitting || cartTotal <= 0) {
      return true;
    }
    if (allowsChange) {
      return paymentSinglePaid < cartTotal;
    }
    return false;
  }, [allowsChange, cartTotal, paymentSinglePaid, paymentSubmitting]);
  const paymentMultipleConfirmDisabled = useMemo(
    () => paymentSubmitting || paymentMultipleTotal <= 0 || paymentMultipleRemaining > 0,
    [paymentMultipleRemaining, paymentMultipleTotal, paymentSubmitting],
  );

  useEffect(() => {
    if (!cartSurcharge.enabled || cartSurcharge.isManual || !cartSurcharge.method || cartSurcharge.method === 'manual') {
      return;
    }
    const rate = SURCHARGE_PRESET_RATES[cartSurcharge.method] ?? 0;
    const computed = roundUpToThousand(cartTotalBeforeSurcharge * rate);
    if (computed === cartSurcharge.amount) {
      return;
    }
    setCartSurcharge((prev) => ({ ...prev, amount: computed }));
  }, [cartSurcharge.amount, cartSurcharge.enabled, cartSurcharge.isManual, cartSurcharge.method, cartTotalBeforeSurcharge]);

  useEffect(() => {
    if (paymentView !== 'single') {
      return;
    }
    if (!requiresManualAmount) {
      setPaymentValue(formatPriceInputValue(String(Math.max(0, Math.round(cartTotal)))) || '0');
    }
  }, [cartTotal, paymentView, requiresManualAmount]);

  useEffect(() => {
    if (paymentView !== 'multiple') {
      return;
    }
    if (!selectedPaymentLine) {
      return;
    }
    setPaymentLineInput(
      formatPriceInputValue(String(Math.max(0, Math.round(selectedPaymentLine.amount)))) || '0',
    );
  }, [paymentView, selectedPaymentLine]);

  const addProductToCart = useCallback((
    product: CatalogProduct,
    overrideUnitPrice?: number,
    options?: { freeSaleReason?: string },
  ) => {
    const unitPrice = Number.isFinite(overrideUnitPrice ?? Number.NaN)
      ? Math.max(0, Number(overrideUnitPrice))
      : product.price;
    setCart((prev) => {
      const reason = options?.freeSaleReason?.trim() ?? '';
      const shouldCreateIndependentLine =
        REQUIRE_FREE_SALE_REASON && isFreeSaleProduct(product) && reason.length > 0;
      const existingIndex = prev.findIndex((item) => item.id === product.id);
      if (existingIndex >= 0 && !shouldCreateIndependentLine) {
        const updated = [...prev];
        const current = updated[existingIndex];
        updated[existingIndex] = {
          ...current,
          quantity: current.quantity + 1,
        };
        return updated;
      }

      return [
        ...prev,
        {
          id: shouldCreateIndependentLine
            ? Date.now() + Math.floor(Math.random() * 1000)
            : product.id,
          product,
          quantity: 1,
          unitPrice,
          lineDiscountValue: 0,
          lineDiscountIsPercent: false,
          lineDiscountPercent: 0,
          freeSaleReason: reason || undefined,
        },
      ];
    });
    setSelectedCartId(product.id);
  }, []);

  const handleCodeScanned = useCallback((codes: Code[]) => {
    if (!scannerOpen || !codes.length) {
      return;
    }
    const firstReadable = codes.find((item) => typeof item.value === 'string' && item.value.trim().length > 0);
    if (!firstReadable?.value) {
      return;
    }
    const now = Date.now();
    if (now - scannerCooldownRef.current < 900) {
      return;
    }
    scannerCooldownRef.current = now;

    const scannedRaw = normalizeBarcode(firstReadable.value);
    if (!scannedRaw) {
      return;
    }
    const scannedWithoutLeadingZeros = scannedRaw.replace(/^0+/, '');
    const product = products.find((candidate) => {
      const barcode = normalizeBarcode(candidate.barcode);
      if (!barcode) {
        return false;
      }
      const barcodeNoZeros = barcode.replace(/^0+/, '');
      return barcode === scannedRaw || barcodeNoZeros === scannedWithoutLeadingZeros;
    });

    if (!product) {
      setScannerOpen(false);
      setSearch('');
      setCurrentPath([]);
      setCurrentPage(1);
      showActionToast(`No se encontraron productos con el código: ${firstReadable.value}`, 2600, 'error');
      return;
    }

    setScannerOpen(false);
    setSearch('');
    setCurrentPath([]);
    setCurrentPage(1);
    addProductToCart(product);
    showActionToast(`Producto agregado: ${product.name}`);
  }, [addProductToCart, products, scannerOpen, showActionToast]);

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'code-128', 'code-39', 'upc-a', 'upc-e', 'qr'],
    onCodeScanned: handleCodeScanned,
  });

  const selectedCartItem = useMemo(
    () => cart.find((item) => item.id === selectedCartId) ?? null,
    [cart, selectedCartId],
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedCartId == null) {
      return;
    }

    setCart((prev) => prev.filter((item) => item.id !== selectedCartId));
    setSelectedCartId(null);
  }, [selectedCartId]);

  const handleOpenQuantityModal = useCallback(() => {
    if (!selectedCartItem) {
      return;
    }

    setQuantityValue(Math.max(1, Math.round(selectedCartItem.quantity)).toString());
    setQuantityModalOpen(true);
  }, [selectedCartItem]);

  const adjustQuantityValue = useCallback((delta: number) => {
    setQuantityValue((current) => {
      const parsed = parseInt(current || '0', 10);
      const next = Math.max(1, (Number.isFinite(parsed) ? parsed : 1) + delta);
      return next.toString();
    });
  }, []);

  const handleApplyQuantity = useCallback(() => {
    if (!selectedCartItem) {
      setQuantityModalOpen(false);
      return;
    }

    const qty = parseInt(quantityValue.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setQuantityModalOpen(false);
      return;
    }

    setCart((prev) =>
      prev.map((item) =>
        item.id === selectedCartItem.id ? { ...item, quantity: qty } : item,
      ),
    );
    setQuantityModalOpen(false);
  }, [quantityValue, selectedCartItem]);

  const handleOpenDiscountModal = useCallback(() => {
    if (!cart.length) {
      return;
    }
    const hasItemDiscount = Boolean(
      selectedCartItem &&
      (selectedCartItem.lineDiscountValue > 0 || selectedCartItem.lineDiscountPercent > 0),
    );
    const hasCartDiscount = cartDiscountValue > 0 || cartDiscountPercent > 0;

    const scope: DiscountScope = hasItemDiscount
      ? 'item'
      : hasCartDiscount
      ? 'cart'
      : selectedCartItem
      ? 'item'
      : 'cart';
    setDiscountScope(scope);

    if (scope === 'item' && selectedCartItem) {
      const nextMode: DiscountMode =
        selectedCartItem.lineDiscountIsPercent && selectedCartItem.lineDiscountPercent > 0 ? 'percent' : 'value';
      const initialValue =
        nextMode === 'percent'
          ? selectedCartItem.lineDiscountPercent.toString()
          : selectedCartItem.lineDiscountValue > 0
          ? selectedCartItem.lineDiscountValue.toString()
          : '';
      setDiscountMode(nextMode);
      setDiscountInput(nextMode === 'value' ? formatPriceInputValue(initialValue) : initialValue);
    } else {
      const nextMode: DiscountMode = cartDiscountPercent > 0 ? 'percent' : 'value';
      const initialValue =
        nextMode === 'percent'
          ? cartDiscountPercent.toString()
          : cartDiscountValue > 0
          ? cartDiscountValue.toString()
          : '';
      setDiscountMode(nextMode);
      setDiscountInput(nextMode === 'value' ? formatPriceInputValue(initialValue) : initialValue);
    }
    setDiscountModalOpen(true);
  }, [cart.length, cartDiscountPercent, cartDiscountValue, selectedCartItem]);

  const handleSelectDiscountScope = (scope: DiscountScope) => {
    setDiscountScope(scope);
    if (scope === 'item' && selectedCartItem) {
      const nextMode: DiscountMode =
        selectedCartItem.lineDiscountIsPercent && selectedCartItem.lineDiscountPercent > 0 ? 'percent' : 'value';
      const initialValue =
        nextMode === 'percent'
          ? selectedCartItem.lineDiscountPercent.toString()
          : selectedCartItem.lineDiscountValue > 0
          ? selectedCartItem.lineDiscountValue.toString()
          : '';
      setDiscountMode(nextMode);
      setDiscountInput(nextMode === 'value' ? formatPriceInputValue(initialValue) : initialValue);
      return;
    }
    const nextMode: DiscountMode = cartDiscountPercent > 0 ? 'percent' : 'value';
    const initialValue =
      nextMode === 'percent'
        ? cartDiscountPercent.toString()
        : cartDiscountValue > 0
        ? cartDiscountValue.toString()
        : '';
    setDiscountMode(nextMode);
    setDiscountInput(nextMode === 'value' ? formatPriceInputValue(initialValue) : initialValue);
  };

  const handleDiscountInputChange = useCallback(
    (value: string) => {
      if (discountMode === 'value') {
        setDiscountInput(formatPriceInputValue(value));
        return;
      }

      setDiscountInput(value.replace(/[^0-9.,]/g, ''));
    },
    [discountMode],
  );

  const handleApplyDiscount = useCallback(() => {
    const rawInput = discountInput.trim();
    const normalized = discountMode === 'value' ? rawInput.replace(/\./g, '') : rawInput.replace(/,/g, '.');
    const value = parseFloat(normalized);
    if (!Number.isFinite(value) || value < 0) {
      setDiscountModalOpen(false);
      return;
    }

    if (discountScope === 'item') {
      if (!selectedCartItem) {
        setDiscountModalOpen(false);
        return;
      }

      if (discountMode === 'value') {
        setCart((prev) =>
          prev.map((item) =>
            item.id === selectedCartItem.id
              ? {
                  ...item,
                  lineDiscountValue: value,
                  lineDiscountIsPercent: false,
                  lineDiscountPercent: 0,
                }
              : item,
          ),
        );
      } else {
        const gross = selectedCartItem.quantity * selectedCartItem.unitPrice;
        const disc = (gross * value) / 100;
        setCart((prev) =>
          prev.map((item) =>
            item.id === selectedCartItem.id
              ? {
                  ...item,
                  lineDiscountValue: disc,
                  lineDiscountIsPercent: true,
                  lineDiscountPercent: value,
                }
              : item,
          ),
        );
      }
    } else if (discountMode === 'value') {
      setCartDiscountValue(value);
      setCartDiscountPercent(0);
    } else {
      setCartDiscountPercent(value);
      setCartDiscountValue(0);
    }

    setDiscountModalOpen(false);
  }, [discountInput, discountMode, discountScope, selectedCartItem]);

  const handleClearDiscount = useCallback(() => {
    if (discountScope === 'item') {
      if (!selectedCartItem) {
        setDiscountModalOpen(false);
        return;
      }
      setCart((prev) =>
        prev.map((item) =>
          item.id === selectedCartItem.id
            ? {
                ...item,
                lineDiscountValue: 0,
                lineDiscountIsPercent: false,
                lineDiscountPercent: 0,
              }
            : item,
        ),
      );
    } else {
      setCartDiscountValue(0);
      setCartDiscountPercent(0);
    }
    setDiscountInput('');
    setDiscountModalOpen(false);
  }, [discountScope, selectedCartItem]);

  const handleOpenSurchargeModal = useCallback(() => {
    if (cartSurcharge.enabled) {
      setCustomSurchargeValue(cartSurcharge.amount > 0 ? String(Math.round(cartSurcharge.amount)) : '');
      if (!cartSurcharge.isManual && cartSurcharge.method && cartSurcharge.method !== 'manual') {
        const rate = SURCHARGE_PRESET_RATES[cartSurcharge.method] ?? 0.05;
        setCustomSurchargePercent(String(Math.round(rate * 100)));
      }
    } else {
      setCustomSurchargeValue('');
      setCustomSurchargePercent('5');
    }
    setSurchargeModalOpen(true);
  }, [cartSurcharge.amount, cartSurcharge.enabled, cartSurcharge.isManual, cartSurcharge.method]);

  const handleCloseSurchargeModal = useCallback(() => {
    setSurchargeModalOpen(false);
  }, []);

  const handleApplySurchargePreset = useCallback((method: Exclude<SurchargeMethod, 'manual' | null>) => {
    const rate = SURCHARGE_PRESET_RATES[method] ?? 0;
    const amount = roundUpToThousand(cartTotalBeforeSurcharge * rate);
    setCartSurcharge({
      method,
      amount,
      enabled: true,
      isManual: false,
    });
    setCustomSurchargePercent(String(Math.round(rate * 100)));
    setSurchargeModalOpen(false);
  }, [cartTotalBeforeSurcharge]);

  const handleApplyManualSurcharge = useCallback(() => {
    const parsedManual = Number(customSurchargeValue.replace(/[^\d]/g, ''));
    let normalized = 0;
    if (parsedManual > 0) {
      normalized = roundUpToThousand(parsedManual);
    } else {
      const percentNumber = Math.min(100, Math.max(0, Number(customSurchargePercent) || 0));
      if (percentNumber > 0) {
        normalized = roundUpToThousand(cartTotalBeforeSurcharge * (percentNumber / 100));
      }
    }
    if (normalized <= 0) {
      setSurchargeModalOpen(false);
      return;
    }
    const preservePresetMethod =
      cartSurcharge.enabled && cartSurcharge.method && cartSurcharge.method !== 'manual'
        ? cartSurcharge.method
        : 'manual';
    setCartSurcharge({
      method: preservePresetMethod,
      amount: normalized,
      enabled: true,
      isManual: true,
    });
    setSurchargeModalOpen(false);
  }, [cartSurcharge.enabled, cartSurcharge.method, cartTotalBeforeSurcharge, customSurchargePercent, customSurchargeValue]);

  const handleDeactivateSurcharge = useCallback(() => {
    setCartSurcharge({
      method: null,
      amount: 0,
      enabled: false,
      isManual: false,
    });
    setCustomSurchargePercent('5');
    setCustomSurchargeValue('');
    setSurchargeModalOpen(false);
  }, []);

  const handleApplyFreeSaleReason = useCallback(() => {
    const reason = freeSaleReasonValue.trim();
    if (!reason) {
      return;
    }
    if (freeSaleReasonTargetCartId) {
      setCart((current) =>
        current.map((item) =>
          item.id === freeSaleReasonTargetCartId ? { ...item, freeSaleReason: reason } : item,
        ),
      );
      setFreeSaleReasonModalOpen(false);
      setFreeSaleReasonTargetCartId(null);
      setFreeSaleReasonProduct(null);
      setFreeSaleReasonValue('');
      return;
    }

    const selectedProduct = freeSaleReasonProduct;
    if (!selectedProduct) {
      setFreeSaleReasonModalOpen(false);
      return;
    }

    setFreeSaleReasonModalOpen(false);
    setPendingFreeSaleReason(reason);
    if (selectedProduct.allow_price_change || selectedProduct.service) {
      setPriceChangeProduct(selectedProduct);
      const initialValue =
        selectedProduct.price && selectedProduct.price > 0
          ? selectedProduct.price.toString()
          : '0';
      setPriceChangeValue(formatPriceInputValue(initialValue) || '0');
      setFreeSaleReasonTargetCartId(null);
      setFreeSaleReasonProduct(null);
      setFreeSaleReasonValue('');
      return;
    }
    addProductToCart(selectedProduct, selectedProduct.price, {
      freeSaleReason: reason,
    });
    setFreeSaleReasonModalOpen(false);
    setFreeSaleReasonTargetCartId(null);
    setFreeSaleReasonProduct(null);
    setFreeSaleReasonValue('');
    setPendingFreeSaleReason(null);
  }, [addProductToCart, freeSaleReasonProduct, freeSaleReasonTargetCartId, freeSaleReasonValue]);

  const handlePriceChangeInput = useCallback((value: string) => {
    const formatted = formatPriceInputValue(value);
    setPriceChangeValue(formatted || '0');
  }, []);

  const handleApplyPriceChange = useCallback(() => {
    if (!priceChangeProduct) {
      return;
    }
    const raw = priceChangeValue.trim().replace(/\./g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val < 0) {
      setPriceChangeProduct(null);
      setPendingFreeSaleReason(null);
      return;
    }
    addProductToCart(priceChangeProduct, val, {
      freeSaleReason: pendingFreeSaleReason ?? undefined,
    });
    setPriceChangeProduct(null);
    setPendingFreeSaleReason(null);
  }, [addProductToCart, pendingFreeSaleReason, priceChangeProduct, priceChangeValue]);

  const handleResetSale = useCallback(async () => {
    await releaseReservation(reservedSaleId);
    setReservedSaleId(null);
    setReservedSaleNumber(null);
    setCart([]);
    setCartDiscountPercent(0);
    setCartDiscountValue(0);
    setCartSurcharge({
      method: null,
      amount: 0,
      enabled: false,
      isManual: false,
    });
    setCustomSurchargeValue('');
    setCustomSurchargePercent('5');
    setSurchargeModalOpen(false);
    setSelectedCartId(null);
    setFreeSaleReasonModalOpen(false);
    setFreeSaleReasonTargetCartId(null);
    setFreeSaleReasonProduct(null);
    setFreeSaleReasonValue('');
    setPendingFreeSaleReason(null);
    setPriceChangeProduct(null);
    setPriceChangeValue('0');
    setPaymentView('none');
    setPaymentLines([]);
    setSelectedPaymentLineId(null);
    setPaymentLineInput('0');
    setPaymentValue('0');
    setPaymentMethod(activePaymentMethods[0]?.slug ?? 'cash');
    setSeparatedPaymentMethod(null);
    setSaleNotes('');
    setPaymentError(null);
    setSaleNotice(null);
    setSuccessSale(null);
    setSelectedCustomer(null);
    try {
      await refreshNextSaleNumber();
    } catch {
      // noop
    }
  }, [activePaymentMethods, refreshNextSaleNumber, releaseReservation, reservedSaleId]);

  const handleAddPaymentLine = useCallback((method: string) => {
    setPaymentLines((current) => {
      const existing = current.find((line) => line.method === method);
      if (existing) {
        setSelectedPaymentLineId(existing.id);
        setPaymentLineInput(formatPriceInputValue(String(Math.max(0, Math.round(existing.amount)))) || '0');
        return current;
      }
      const line: PaymentLine = { id: Date.now(), method, amount: 0, separatedRealMethod: null };
      setSelectedPaymentLineId(line.id);
      setPaymentLineInput('0');
      return [...current, line];
    });
  }, []);

  const handleSelectPaymentLine = useCallback((lineId: number) => {
    const line = paymentLines.find((entry) => entry.id === lineId);
    if (!line) {
      return;
    }
    setSelectedPaymentLineId(lineId);
    setPaymentLineInput(formatPriceInputValue(String(Math.max(0, Math.round(line.amount)))) || '0');
  }, [paymentLines]);

  const handleDeletePaymentLine = useCallback((lineId: number) => {
    setPaymentLines((current) => {
      if (current.length <= 1) {
        return current;
      }
      const next = current.filter((line) => line.id !== lineId);
      if (!next.length) {
        return current;
      }
      if (selectedPaymentLineId === lineId) {
        setSelectedPaymentLineId(next[0].id);
        setPaymentLineInput(formatPriceInputValue(String(Math.max(0, Math.round(next[0].amount)))) || '0');
      }
      return next;
    });
  }, [selectedPaymentLineId]);

  const handlePaymentLineAmountChange = useCallback((value: string) => {
    const formatted = formatPriceInputValue(value);
    setPaymentLineInput(formatted || '0');
    if (!selectedPaymentLineId) {
      return;
    }
    const amount = Number((formatted || '0').replace(/[^\d]/g, '')) || 0;
    setPaymentLines((current) =>
      current.map((line) => (line.id === selectedPaymentLineId ? { ...line, amount } : line)),
    );
  }, [selectedPaymentLineId]);

  const handleSinglePaymentAmountChange = useCallback((value: string) => {
    const formatted = formatPriceInputValue(value);
    setPaymentValue(formatted || '0');
  }, []);

  const handleSelectPaymentMethod = useCallback((method: string) => {
    if (paymentView === 'multiple') {
      handleAddPaymentLine(method);
      return;
    }
    setPaymentMethod(method);
    setSeparatedPaymentMethod(null);
    if (creditMethodSlugs.has(method)) {
      setPaymentValue('0');
      return;
    }
    const methodConfig = activePaymentMethods.find((entry) => entry.slug === method);
    if (methodConfig?.allow_change) {
      setPaymentValue('0');
      return;
    }
    setPaymentValue(formatPriceInputValue(String(Math.max(0, Math.round(cartTotal)))) || '0');
  }, [activePaymentMethods, cartTotal, creditMethodSlugs, handleAddPaymentLine, paymentView]);

  const handleSetMultipleMode = useCallback(() => {
    setPaymentView('multiple');
    setPaymentError(null);
    setPaymentLines((current) => {
      if (current.length > 0) {
        return current;
      }
      const firstMethod = activePaymentMethods[0]?.slug ?? paymentMethod ?? 'cash';
      const line: PaymentLine = { id: Date.now(), method: firstMethod, amount: 0, separatedRealMethod: null };
      setSelectedPaymentLineId(line.id);
      setPaymentLineInput('0');
      return [line];
    });
  }, [activePaymentMethods, paymentMethod]);

  const handleSetSingleMode = useCallback(() => {
    setPaymentView('single');
    setPaymentError(null);
  }, []);

  const handleSetSeparatedMethodForLine = useCallback((lineId: number, slug: string) => {
    setPaymentLines((current) =>
      current.map((line) =>
        line.id === lineId ? { ...line, separatedRealMethod: slug } : line,
      ),
    );
  }, []);

  const handleOpenPaymentScreen = useCallback(async () => {
    if (!cart.length) {
      showActionToast('Agrega al menos un artículo para continuar a pago.', 2600, 'error');
      return;
    }
    if (paymentSubmitting) {
      showActionToast('Estamos procesando una operación. Intenta nuevamente en unos segundos.', 2600, 'error');
      return;
    }
    if (missingFreeSaleReason) {
      const pending = cart.find((item) => isFreeSaleProduct(item.product) && !item.freeSaleReason?.trim());
      if (pending) {
        setSelectedCartId(pending.id);
        setFreeSaleReasonTargetCartId(pending.id);
        setFreeSaleReasonProduct(pending.product);
        setFreeSaleReasonValue(pending.freeSaleReason ?? '');
        setFreeSaleReasonModalOpen(true);
      }
      setPaymentError('Debes registrar el motivo de venta libre antes de continuar.');
      showActionToast('Debes registrar el motivo de venta libre antes de continuar.', 2600, 'error');
      return;
    }

    setSaleNotice(null);
    setPaymentError(null);
    setPaymentView('single');
    const defaultMethod = activePaymentMethods[0]?.slug ?? 'cash';
    setPaymentMethod(defaultMethod);
    const defaultMethodConfig = activePaymentMethods.find((entry) => entry.slug === defaultMethod);
    const defaultRequiresManual = Boolean(defaultMethodConfig?.allow_change) || creditMethodSlugs.has(defaultMethod);
    setPaymentValue(
      defaultRequiresManual
        ? '0'
        : formatPriceInputValue(String(Math.max(0, Math.round(cartTotal)))) || '0',
    );
    const firstLine: PaymentLine = { id: Date.now(), method: defaultMethod, amount: 0, separatedRealMethod: null };
    setPaymentLines([firstLine]);
    setSelectedPaymentLineId(firstLine.id);
    setPaymentLineInput('0');
    setSeparatedPaymentMethod(null);
    try {
      await ensureSaleReservation();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo reservar el consecutivo.';
      setPaymentError(message);
      showActionToast(message, 2600, 'error');
    }
  }, [activePaymentMethods, cart, cartTotal, creditMethodSlugs, ensureSaleReservation, missingFreeSaleReason, paymentSubmitting, showActionToast]);

  const handleCancelPaymentScreen = useCallback(async () => {
    setPaymentView('none');
    setPaymentError(null);
    await releaseReservation(reservedSaleId);
    setReservedSaleId(null);
    setReservedSaleNumber(null);
    try {
      await refreshNextSaleNumber();
    } catch {
      // noop
    }
  }, [refreshNextSaleNumber, releaseReservation, reservedSaleId]);

  const handleConfirmPayment = useCallback(async () => {
    if (!cart.length || paymentSubmitting) {
      return;
    }

    setPaymentSubmitting(true);
    setPaymentError(null);
    setSaleNotice(null);
    try {
      let payloadPayments: { method: string; amount: number }[] = [];
      let paidAmount = 0;
      let changeAmount = 0;
      let primaryMethod = paymentMethod;

      if (paymentView === 'single') {
        if (paymentMethod === 'separado' && !separatedPaymentMethod) {
          setPaymentError('Selecciona el método del abono inicial.');
          return;
        }
        paidAmount = paymentSinglePaid;
        changeAmount = paymentSingleChange;
        primaryMethod = paymentMethod;

        if (!isCreditLike && allowsChange && paidAmount < cartTotal) {
          setPaymentError('El monto en efectivo no puede ser menor al total.');
          return;
        }

        payloadPayments = [
          {
            method: paymentMethod === 'separado' ? separatedPaymentMethod ?? paymentMethod : paymentMethod,
            amount: paidAmount,
          },
        ];
      } else {
        if (!paymentLines.length) {
          setPaymentError('Agrega al menos una linea de pago.');
          return;
        }
        paidAmount = paymentMultipleTotal;
        changeAmount = paymentMultipleChange;
        primaryMethod = paymentLines[0]?.method ?? 'cash';

        if (paidAmount <= 0) {
          setPaymentError('El total pagado debe ser mayor a cero.');
          return;
        }
        const hasCreditLikeInLines = paymentLines.some((line) => creditMethodSlugs.has(line.method));
        if (
          hasCreditLikeInLines &&
          paymentLines.some((line) => !creditMethodSlugs.has(line.method))
        ) {
          setPaymentError('Crédito y separado no se pueden mezclar con otros métodos por ahora.');
          return;
        }
        const isSeparatedSale = paymentLines.length > 0 && paymentLines.every((line) => line.method === 'separado');
        if (isSeparatedSale && paymentLines.some((line) => !line.separatedRealMethod)) {
          setPaymentError('Selecciona el método real para cada línea de separado.');
          return;
        }
        if (!hasCreditLikeInLines && paymentMultipleRemaining > 0) {
          setPaymentError('El total pagado no puede ser menor al total de la venta.');
          return;
        }

        changeAmount = isSeparatedSale ? 0 : Math.max(0, paidAmount - cartTotal);
        payloadPayments = paymentLines
          .filter((line) => line.amount > 0)
          .map((line) => ({
            method: line.method === 'separado' ? line.separatedRealMethod ?? line.method : line.method,
            amount: line.amount,
          }));
      }

      let reservation = await ensureSaleReservation();
      const combinedSaleNotes = (() => {
        const extra = saleNotes.trim();
        const blocks: string[] = [];
        if (REQUIRE_FREE_SALE_REASON && freeSaleReasons.length > 0) {
          const lines = freeSaleReasons.map((reason, index) => `${index + 1}. ${reason}`);
          blocks.push(`Motivo venta libre:\n${lines.join('\n')}`);
        }
        if (extra) {
          blocks.push(extra);
        }
        return blocks.join('\n\n');
      })();
      const buildPayload = (saleNumber: number, reservationId: number) => ({
        payment_method: primaryMethod,
        total: cartTotal,
        paid_amount: paidAmount,
        change_amount: changeAmount,
        sale_number_preassigned: saleNumber,
        reservation_id: reservationId,
        pos_name: resolvedPosName,
        vendor_name: user?.name ?? undefined,
        station_id: stationId.trim() || undefined,
        customer_id: selectedCustomer?.id,
        payments: payloadPayments,
        notes: combinedSaleNotes || undefined,
        surcharge_amount: cartSurcharge.enabled && cartSurcharge.amount > 0 ? cartSurcharge.amount : undefined,
        surcharge_label:
          cartSurcharge.enabled && cartSurcharge.amount > 0
            ? `Incremento ${getSurchargeMethodLabel(cartSurcharge.method)}`
            : undefined,
        items: cart.map((item) => {
          const gross = item.quantity * item.unitPrice;
          const lineTotal = Math.max(0, gross - item.lineDiscountValue);
          return {
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            product_sku: item.product.sku,
            product_name: item.product.name,
            product_barcode: item.product.barcode,
            discount: item.lineDiscountValue,
            total: lineTotal,
          };
        }),
      });

      let sale: Awaited<ReturnType<typeof createSale>>;
      try {
        sale = await createSale(apiClient, buildPayload(reservation.saleNumber, reservation.reservationId));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await releaseReservation(reservation.reservationId);
          const next = await refreshNextSaleNumber();
          const retried = await reserveSaleNumber(apiClient, {
            pos_name: resolvedPosName,
            station_id: stationId.trim() || undefined,
            min_sale_number: next ?? undefined,
          });
          setReservedSaleId(retried.reservation_id);
          setReservedSaleNumber(retried.sale_number);
          reservation = {
            reservationId: retried.reservation_id,
            saleNumber: retried.sale_number,
          };
          sale = await createSale(apiClient, buildPayload(reservation.saleNumber, reservation.reservationId));
        } else {
          throw err;
        }
      }

      const backendSaleNumber = sale.sale_number ?? reservation.saleNumber;
      const documentNo = sale.document_number ?? `V-${sale.id.toString().padStart(6, '0')}`;
      const saleWithSurcharge = sale as typeof sale & {
        surcharge_amount?: number;
        surcharge_label?: string;
      };
      const responseSurchargeAmount =
        typeof saleWithSurcharge.surcharge_amount === 'number' && saleWithSurcharge.surcharge_amount > 0
          ? saleWithSurcharge.surcharge_amount
          : undefined;
      const summarySurchargeAmount =
        responseSurchargeAmount ??
        (cartSurcharge.enabled && cartSurcharge.amount > 0 ? cartSurcharge.amount : undefined);
      const summarySurchargeLabel =
        saleWithSurcharge.surcharge_label ??
        (summarySurchargeAmount
          ? cartSurcharge.method
            ? `Incremento ${getSurchargeMethodLabel(cartSurcharge.method)}`
            : 'Incremento'
          : undefined);
      const paymentSummary = payloadPayments.map((payment) => ({
        label:
          activePaymentMethods.find((method) => method.slug === payment.method)?.name ??
          payment.method,
        amount: payment.amount,
      }));

      setSuccessSale({
        saleId: sale.id,
        documentNumber: documentNo,
        saleNumber: backendSaleNumber,
        total: cartTotal,
        subtotal: cartSubtotal,
        lineDiscountTotal: cartLineDiscountTotal,
        cartDiscountLabel:
          cartDiscountValue > 0
            ? 'Descuento carrito (valor)'
            : cartDiscountPercent > 0
            ? 'Descuento carrito (%)'
            : 'Descuento carrito',
        cartDiscountValueDisplay:
          cartDiscountValue > 0
            ? `-${formatMoney(cartDiscountValue)}`
            : cartDiscountPercent > 0
            ? `-${cartDiscountPercent}%`
            : '0',
        surchargeLabel: summarySurchargeLabel,
        surchargeValueDisplay:
          typeof summarySurchargeAmount === 'number' ? formatMoney(summarySurchargeAmount) : undefined,
        notes: combinedSaleNotes || undefined,
        changeAmount: Math.max(0, changeAmount),
        showChange: Math.max(0, changeAmount) > 0,
        payments: paymentSummary,
        customer: selectedCustomer
          ? {
              name: selectedCustomer.name,
              phone: selectedCustomer.phone ?? undefined,
              email: selectedCustomer.email ?? undefined,
              taxId: selectedCustomer.tax_id ?? undefined,
              address: selectedCustomer.address ?? undefined,
            }
          : undefined,
      });

      setCart([]);
      setCartDiscountPercent(0);
      setCartDiscountValue(0);
      setCartSurcharge({
        method: null,
        amount: 0,
        enabled: false,
        isManual: false,
      });
      setCustomSurchargeValue('');
      setCustomSurchargePercent('5');
      setSelectedCartId(null);
      setSearch('');
      setCurrentPath([]);
      setCurrentPage(1);
      setPaymentView('none');
      setReservedSaleId(null);
      setReservedSaleNumber(null);
      setSaleNotes('');
      setSaleNotice(null);
      setSelectedCustomer(null);
      await refreshNextSaleNumber();
    } catch (err) {
      if (err instanceof ApiError) {
        setPaymentError(err.detail || err.message);
      } else if (err instanceof Error) {
        setPaymentError(err.message);
      } else {
        setPaymentError('No se pudo registrar la venta.');
      }
    } finally {
      setPaymentSubmitting(false);
    }
  }, [
    activePaymentMethods,
    apiClient,
    cart,
    cartDiscountPercent,
    cartDiscountValue,
    cartLineDiscountTotal,
    cartSurcharge.amount,
    cartSurcharge.enabled,
    cartSurcharge.method,
    cartSubtotal,
    cartTotal,
    creditMethodSlugs,
    ensureSaleReservation,
    freeSaleReasons,
    isCreditLike,
    allowsChange,
    paymentLines,
    paymentMethod,
    paymentView,
    paymentMultipleChange,
    paymentMultipleRemaining,
    paymentMultipleTotal,
    paymentSingleChange,
    paymentSinglePaid,
    paymentSubmitting,
    saleNotes,
    separatedPaymentMethod,
    refreshNextSaleNumber,
    releaseReservation,
    resolvedPosName,
    selectedCustomer,
    stationId,
    user?.name,
  ]);

  const handleSuccessDone = useCallback(() => {
    setSuccessSale(null);
    setSaleNotice(null);
    setSearch('');
    setCurrentPath([]);
    setCurrentPage(1);
  }, []);

  const handleOpenCustomerModal = useCallback(() => {
    setCustomerModalOpen(true);
    setCustomerMode('list');
    setCustomerError(null);
    setPendingCustomerSelection(null);
    setCustomerPage(0);
    setCustomerListReady(false);
  }, []);

  const handleCloseCustomerModal = useCallback(() => {
    setCustomerModalOpen(false);
    setPendingCustomerSelection(null);
    setCustomerError(null);
    setCustomerMode('list');
    setCustomerForm(EMPTY_CUSTOMER_FORM);
    setCustomerPage(0);
    setCustomerListReady(false);
  }, []);

  const handleConfirmAssignCustomer = useCallback(() => {
    if (!pendingCustomerSelection) {
      return;
    }
    setSelectedCustomer(pendingCustomerSelection);
    setPendingCustomerSelection(null);
    setCustomerModalOpen(false);
    setCustomerMode('list');
    setCustomerForm(EMPTY_CUSTOMER_FORM);
    showActionToast(`Cliente asignado: ${pendingCustomerSelection.name}`);
  }, [pendingCustomerSelection, showActionToast]);

  const handleCustomerSearchChange = useCallback((value: string) => {
    setCustomerSearch(value);
    setCustomerPage(0);
    setCustomerListReady(false);
  }, []);

  const handleCreateCustomer = useCallback(async () => {
    const name = customerForm.name.trim();
    if (!name) {
      setCustomerError('El nombre del cliente es obligatorio.');
      return;
    }
    setCustomerSaving(true);
    setCustomerError(null);
    try {
      const customer = await createPosCustomer(apiClient, {
        name,
        phone: customerForm.phone.trim() || undefined,
        email: customerForm.email.trim() || undefined,
        tax_id: customerForm.taxId.trim() || undefined,
        address: customerForm.address.trim() || undefined,
        is_active: true,
      });
      setSelectedCustomer(customer);
      setCustomerModalOpen(false);
      setCustomerMode('list');
      setCustomerForm(EMPTY_CUSTOMER_FORM);
      setCustomerSearch('');
      showActionToast(`Cliente creado y asignado: ${customer.name}`);
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'No se pudo guardar el cliente.');
    } finally {
      setCustomerSaving(false);
    }
  }, [apiClient, customerForm.address, customerForm.email, customerForm.name, customerForm.phone, customerForm.taxId, showActionToast]);

  const handleTilePress = useCallback((tile: GridTile) => {
    if (tile.type === 'back') {
      setCurrentPath((previous) => previous.slice(0, -1));
      return;
    }

    if (tile.type === 'group') {
      setCurrentPath(tile.path);
      return;
    }

    if (REQUIRE_FREE_SALE_REASON && isFreeSaleProduct(tile.product)) {
      setFreeSaleReasonTargetCartId(null);
      setFreeSaleReasonProduct(tile.product);
      setFreeSaleReasonValue('');
      setFreeSaleReasonModalOpen(true);
      return;
    }

    if (tile.product.allow_price_change || tile.product.service) {
      setPriceChangeProduct(tile.product);
      const initialValue =
        tile.product.price && tile.product.price > 0
          ? tile.product.price.toString()
          : '0';
      setPriceChangeValue(formatPriceInputValue(initialValue) || '0');
      return;
    }

    addProductToCart(tile.product);
  }, [addProductToCart]);

  const handleGoHome = useCallback(() => {
    setSearch('');
    setCurrentPath([]);
    setCurrentPage(1);
  }, []);

  const renderCatalogTile = useCallback((tile: GridTile) => {
    if (tile.type === 'back') {
      return (
        <Pressable
          key={tile.id}
          style={[styles.backTile, { width: gridMetrics.tileWidth, height: gridMetrics.tileHeight }]}
          onPress={() => handleTilePress(tile)}
        >
          <Text style={styles.backTileText}>← Volver</Text>
        </Pressable>
      );
    }

    if (tile.type === 'group') {
      return (
        <Pressable
          key={tile.id}
          style={[
            styles.categoryTile,
            {
              width: gridMetrics.tileWidth,
              height: gridMetrics.tileHeight,
              padding: gridMetrics.tilePadding,
            },
            tile.color ? { backgroundColor: tile.color } : null,
          ]}
          onPress={() => handleTilePress(tile)}
        >
          {tile.imageUrl ? (
            <Image
              source={{ uri: tile.imageUrl }}
              style={[
                styles.tileImage,
                {
                  width: gridMetrics.imageWidth,
                  height: gridMetrics.imageHeight,
                },
              ]}
              resizeMode="contain"
            />
          ) : null}
          <Text
            style={[styles.categoryTileLabel, { fontSize: gridMetrics.labelFontSize }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {tile.label}
          </Text>
        </Pressable>
      );
    }

    const product = tile.product;
    const productImage = resolveAssetUrl(product.image_thumb_url ?? product.image_url);
    const tileStyle = product.tile_color ? { backgroundColor: product.tile_color } : null;

    return (
      <Pressable
        key={tile.id}
        style={[
          styles.productTile,
          {
            width: gridMetrics.tileWidth,
            height: gridMetrics.tileHeight,
            padding: gridMetrics.tilePadding,
          },
          tileStyle,
        ]}
        onPress={() => handleTilePress(tile)}
      >
        <View style={styles.productTileMain}>
          {productImage ? (
            <Image
              source={{ uri: productImage }}
              style={[
                styles.tileImage,
                {
                  width: gridMetrics.imageWidth,
                  height: gridMetrics.imageHeight,
                },
              ]}
              resizeMode="contain"
            />
          ) : null}
          <Text
            style={[styles.productTileLabel, { fontSize: gridMetrics.labelFontSize - 1 }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {product.name}
          </Text>
        </View>
        <View style={styles.productTileFooter}>
          <Text
            style={[styles.productTilePrice, { fontSize: gridMetrics.priceFontSize }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {formatMoney(product.price)}
          </Text>
        </View>
      </Pressable>
    );
  }, [gridMetrics, handleTilePress, resolveAssetUrl]);

  const handleOpenSaleDocument = useCallback(
    async (documentType: 'ticket' | 'invoice') => {
      if (!successSale) {
        return;
      }
      if (!token) {
        showActionToast('Sesión expirada. Inicia sesión nuevamente.', 2600, 'error');
        return;
      }
      try {
        const base = apiBase.replace(/\/$/, '');
        const url =
          `${base}/pos/sales/${successSale.saleId}/document-view` +
          `?document_type=${encodeURIComponent(documentType)}` +
          `${documentType === 'ticket' ? '&layout=thermal' : ''}` +
          `&access_token=${encodeURIComponent(token)}`;
        const opened = await Linking.openURL(url).then(() => true).catch(() => false);
        if (!opened) {
          throw new Error('No se pudo abrir el documento para impresión.');
        }
      } catch (err) {
        showActionToast(
          err instanceof Error
            ? err.message
            : 'No se pudo preparar el documento para imprimir.',
          2600,
          'error',
        );
      }
    },
    [apiBase, successSale, showActionToast, token],
  );

  const handleSendSaleDocumentByEmail = useCallback(
    async (documentType: 'ticket' | 'invoice') => {
      if (!successSale) {
        return;
      }
      const recipient = successSale.customer?.email?.trim();
      if (!recipient) {
        showActionToast('El cliente no tiene correo. Agrega email para enviar el documento.', 2600, 'error');
        return;
      }
      try {
        await apiClient.post(`/pos/sales/${successSale.saleId}/email`, {
          recipients: [recipient],
          attach_pdf: false,
          document_type: documentType,
        });
        showActionToast(
          documentType === 'invoice'
            ? 'Factura enviada al correo del cliente.'
            : 'Ticket enviado al correo del cliente.',
        );
      } catch (err) {
        showActionToast(
          err instanceof Error ? err.message : 'No se pudo enviar el documento por correo.',
          2600,
          'error',
        );
      }
    },
    [apiClient, successSale, showActionToast],
  );

  const handleDividerPress = useCallback(() => {
    const now = Date.now();
    if (now - lastDividerTapRef.current < 280) {
      cartWidthRef.current = DEFAULT_CART_WIDTH;
      setCartWidth(DEFAULT_CART_WIDTH);
      lastDividerTapRef.current = 0;
      return;
    }

    lastDividerTapRef.current = now;
  }, []);

  const menuOverlayInsetsStyle = useMemo(
    () => ({
      paddingTop: Math.max(8, insets.top + 8),
      paddingBottom: Math.max(8, insets.bottom + 8),
    }),
    [insets.bottom, insets.top],
  );

  if (historyPageOpen) {
    return (
      <SalesHistoryScreen
        apiClient={apiClient}
        paymentMethods={activePaymentMethods}
        onBack={() => {
          setHistoryPageOpen(false);
          setUserMenuOpen(false);
          setUserMenuVisible(false);
          slideAnim.setValue(0);
        }}
        onShowToast={showActionToast}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <View style={styles.container}>
        <View style={[styles.topBar, { paddingTop: Math.max(4, insets.top), minHeight: 74 + Math.max(0, insets.top - 4) }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionsRow}
          >
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.label}
                style={[
                  styles.actionButton,
                  action.tone === 'danger' ? styles.actionButtonDanger : null,
                  action.tone === 'accent' ? styles.actionButtonAccent : null,
                ]}
                onPress={
                  action.label === 'Eliminar'
                    ? handleDeleteSelected
                    : action.label === 'Cantidad'
                      ? handleOpenQuantityModal
                      : action.label === 'Descuento'
                        ? handleOpenDiscountModal
                        : action.label === 'Cliente'
                          ? handleOpenCustomerModal
                      : undefined
                }
              >
                <Text
                  style={[
                    styles.actionButtonText,
                    action.tone === 'danger' ? styles.actionButtonTextDanger : null,
                    action.tone === 'accent' ? styles.actionButtonTextAccent : null,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.topBarMeta}>
            <Pressable
              style={[
                styles.syncButton,
                catalogUpdateAvailable && !syncingCatalog ? styles.syncButtonAlert : null,
                syncingCatalog ? styles.syncButtonDisabled : null,
              ]}
              onPress={() => {
                handleManualSync().catch(() => undefined);
              }}
              disabled={syncingCatalog}
            >
              {syncingCatalog ? (
                <ActivityIndicator size="small" color="#f1f6ff" />
              ) : null}
              <Text style={styles.syncButtonText}>{syncingCatalog ? 'Sincronizando...' : 'Sincronizar'}</Text>
              {catalogUpdateAvailable && !syncingCatalog ? <View style={styles.syncButtonBadge} /> : null}
            </Pressable>
            <Pressable style={styles.syncChip} onPress={() => setShowSyncModal(true)}>
              <View style={[styles.syncDot, { backgroundColor: syncMeta.color }]} />
            </Pressable>
            <Pressable style={styles.userSummary} onPress={openUserMenu}>
              <Text style={styles.userName}>{user?.name ?? 'Usuario POS'}</Text>
              <Text style={styles.userRole}>{user?.role ?? stationLabel ?? 'Caja tablet'}</Text>
            </Pressable>
            <Pressable style={styles.avatarButton} onPress={openUserMenu}>
              <Text style={styles.avatarText}>{userInitials}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.body} onLayout={handleBodyLayout}>
          <View style={[styles.cartColumn, { width: cartWidth }]}>
              <View style={styles.cartMeta}>
                <View>
                  <Text style={styles.cartTitle}>Carrito</Text>
                  <Text style={styles.cartSaleNo}>
                    Venta No.{reservedSaleNumber ?? currentSaleNumber ?? '--'}
                  </Text>
                  {selectedCustomer ? (
                    <View style={styles.cartCustomerRow}>
                      <Text style={styles.cartCustomerInfo}>Cliente: {selectedCustomer.name}</Text>
                      <Pressable
                        style={styles.cartCustomerRemoveButton}
                        onPress={() => {
                          setSelectedCustomer(null);
                          showActionToast('Cliente removido de la venta.');
                        }}
                      >
                        <Text style={styles.cartCustomerRemoveText}>Quitar</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cartLines}>{cart.length} lineas</Text>
              </View>

              {saleNotice ? (
                <View style={styles.saleNoticeWrap}>
                  <Text style={styles.saleNoticeText}>{saleNotice}</Text>
                </View>
              ) : null}

            <ScrollView style={styles.cartItemsList} contentContainerStyle={styles.cartItemsContent}>
              {cart.length === 0 ? (
                <View style={styles.cartItemsEmpty}>
                  <Text style={styles.cartEmptyText}>No hay articulos</Text>
                </View>
              ) : (
                cart.map((item) => {
                  const isSelected = item.id === selectedCartId;
                  const lineGross = item.quantity * item.unitPrice;
                  const lineTotal = Math.max(0, lineGross - item.lineDiscountValue);

                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.cartItemRow, isSelected ? styles.cartItemRowSelected : null]}
                      onPress={() => setSelectedCartId(item.id)}
                    >
                      <View style={styles.cartItemMain}>
                        <Text style={styles.cartItemName} numberOfLines={2}>
                          {item.product.name}
                        </Text>
                        <Text style={styles.cartItemMeta}>
                          {item.quantity} x {formatMoney(item.unitPrice)}
                        </Text>
                      </View>
                      <View style={styles.cartItemPriceWrap}>
                        {item.lineDiscountValue > 0 ? (
                          <Text style={styles.cartItemPriceMuted}>{formatMoney(lineGross)}</Text>
                        ) : null}
                        <Text style={styles.cartItemPrice}>{formatMoney(lineTotal)}</Text>
                        {item.lineDiscountValue > 0 ? (
                          <Text style={styles.cartItemDiscount}>Descuento -{formatMoney(item.lineDiscountValue)}</Text>
                        ) : null}
                        {item.freeSaleReason?.trim() ? (
                          <Text style={styles.cartItemDiscount}>Motivo: {item.freeSaleReason.trim()}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.totalsPanel}>
              {cartLineDiscountTotal > 0 ? (
                <>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabelMuted}>Subtotal sin descuentos</Text>
                    <Text style={styles.totalValueMuted}>{formatMoney(cartGrossSubtotal)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabelAccent}>Descuento articulos</Text>
                    <Text style={styles.totalValueAccent}>-{formatMoney(cartLineDiscountTotal)}</Text>
                  </View>
                </>
              ) : null}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>{formatMoney(cartSubtotal)}</Text>
              </View>
              {cartDiscountValue > 0 || cartDiscountPercent > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabelAccent}>Descuento carrito</Text>
                  <Text style={styles.totalValueAccent}>
                    {cartDiscountValue > 0 ? `-${formatMoney(cartDiscountValue)}` : `-${cartDiscountPercent}%`}
                  </Text>
                </View>
              ) : (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Descuento carrito</Text>
                  <Text style={styles.totalValue}>0</Text>
                </View>
              )}
              {cartSurcharge.enabled && cartSurcharge.amount > 0 ? (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    Incremento{cartSurcharge.method ? ` ${getSurchargeMethodLabel(cartSurcharge.method)}` : ''}
                  </Text>
                  <Text style={styles.totalValue}>{formatMoney(cartSurcharge.amount)}</Text>
                </View>
              ) : null}
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>TOTAL</Text>
                <Text style={styles.grandTotalValue}>{formatMoney(cartTotal)}</Text>
              </View>
              <Pressable
                style={[
                  styles.paymentLock,
                  canProceedToPayment ? styles.paymentLockActive : styles.paymentLockDisabled,
                ]}
                onPress={() => {
                  handleOpenPaymentScreen().catch(() => undefined);
                }}
              >
                <Text
                  style={[
                    styles.paymentLockText,
                    canProceedToPayment ? styles.paymentLockTextActive : null,
                  ]}
                >
                  Pago
                </Text>
              </Pressable>
            </View>

            <View style={[styles.cartActions, { paddingBottom: 10 + Math.max(0, insets.bottom - 4) }]}>
              <Pressable
                style={[styles.footerAction, styles.footerActionDanger]}
                onPress={() => {
                  handleResetSale().catch(() => undefined);
                }}
              >
                <Text style={styles.footerActionDangerText}>Anular orden</Text>
              </Pressable>
              <Pressable style={styles.footerAction}>
                <Text style={styles.footerActionText}>Bloquear</Text>
              </Pressable>
              <Pressable style={styles.footerAction} onPress={handleOpenSurchargeModal}>
                <Text style={styles.footerActionText}>
                  {cartSurcharge.enabled
                    ? `Incremento\n${getSurchargeMethodLabel(cartSurcharge.method)}`
                    : 'Incremento'}
                </Text>
              </Pressable>
            </View>
          </View>

          <View
            style={styles.resizeHandle}
            onTouchEnd={handleDividerPress}
            {...dividerPanResponder.panHandlers}
          >
            <View style={styles.resizeHandleLine} />
          </View>

          <View style={styles.contentColumn}>
            <View style={styles.searchWrap}>
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar productos por nombre, codigo o codigo de barras"
                    placeholderTextColor="#7282a3"
                    style={styles.searchInput}
                  />
                  {search.length > 0 ? (
                    <Pressable
                      style={styles.searchClearButton}
                      onPress={() => setSearch('')}
                      hitSlop={8}
                    >
                      <Text style={styles.searchClearButtonText}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  style={styles.searchScannerButton}
                  onPress={() => { handleOpenScanner().catch(() => undefined); }}
                >
                  <View style={styles.searchScannerIconFrame}>
                    <View style={[styles.searchScannerCorner, styles.searchScannerCornerTopLeft]} />
                    <View style={[styles.searchScannerCorner, styles.searchScannerCornerTopRight]} />
                    <View style={[styles.searchScannerCorner, styles.searchScannerCornerBottomLeft]} />
                    <View style={[styles.searchScannerCorner, styles.searchScannerCornerBottomRight]} />
                    <View style={styles.searchScannerBarsWrap}>
                      <View style={[styles.searchScannerBar, styles.searchScannerBarNarrow]} />
                      <View style={styles.searchScannerBar} />
                      <View style={[styles.searchScannerBar, styles.searchScannerBarNarrow]} />
                    </View>
                  </View>
                </Pressable>
              </View>
            </View>

            <ScrollView
              style={styles.catalogScroll}
              contentContainerStyle={styles.catalogContent}
              showsVerticalScrollIndicator={false}
              onLayout={handleCatalogLayout}
            >
              {error ? (
                <View style={styles.stateCard}>
                  <Text style={styles.stateTitle}>No se pudo cargar el catalogo</Text>
                  <Text style={styles.stateBody}>{error}</Text>
                </View>
              ) : null}

              {!error ? (
                <View style={styles.tilePagerViewport}>
                  {shouldPaginate ? (
                    <FlatList
                      ref={catalogPagerRef}
                      data={pagedTiles}
                      keyExtractor={(_, index) => `catalog-page-${index}`}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      bounces={false}
                      nestedScrollEnabled
                      scrollEventThrottle={16}
                      initialNumToRender={2}
                      maxToRenderPerBatch={2}
                      windowSize={3}
                      extraData={[gridMetrics.tileWidth, gridMetrics.tileHeight, gridZoom]}
                      onMomentumScrollEnd={handleCatalogPagerMomentumEnd}
                      onScrollToIndexFailed={handleCatalogPagerScrollToIndexFailed}
                      renderItem={({ item }) => (
                        <View style={[styles.tilePagerPage, { width: catalogPageWidth }]}>
                          <View style={styles.tileGrid}>
                            {item.map(renderCatalogTile)}
                          </View>
                        </View>
                      )}
                    />
                  ) : (
                    <View style={styles.tileGrid}>
                      {tiles.map(renderCatalogTile)}
                    </View>
                  )}

                  {!isLoading && pageTiles.length === 0 ? (
                    <View style={styles.stateCard}>
                      <Text style={styles.stateTitle}>No hay elementos para mostrar</Text>
                      <Text style={styles.stateBody}>Prueba otra búsqueda o vuelve al inicio.</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            <View style={[styles.catalogFooter, { paddingBottom: Math.max(10, insets.bottom + 4) }]}>
              <View style={styles.catalogFooterLeft}>
                <Text style={styles.catalogFooterText}>
                  {shouldPaginate ? `Pagina ${safePage} / ${totalPages}` : 'Inicio'}
                </Text>
                {(currentPath.length > 0 || search.trim().length > 0) ? (
                  <Pressable style={styles.homeButton} onPress={handleGoHome}>
                    <Text style={styles.homeButtonText}>Home</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.footerControls}>
                {shouldPaginate ? (
                  <View style={styles.pageControls}>
                    <Pressable
                      style={[styles.zoomButton, safePage <= 1 ? styles.zoomButtonDisabled : null]}
                      disabled={safePage <= 1}
                      onPress={() => {
                        goToCatalogPage(Math.max(1, safePage - 1));
                      }}
                    >
                      <Text style={styles.zoomButtonText}>‹</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.zoomButton, safePage >= totalPages ? styles.zoomButtonDisabled : null]}
                      disabled={safePage >= totalPages}
                      onPress={() => {
                        goToCatalogPage(Math.min(totalPages, safePage + 1));
                      }}
                    >
                      <Text style={styles.zoomButtonText}>›</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.zoomControls}>
                  <Pressable
                    style={[styles.zoomButton, gridZoom <= MIN_GRID_ZOOM ? styles.zoomButtonDisabled : null]}
                    disabled={gridZoom <= MIN_GRID_ZOOM}
                    onPress={() =>
                      setGridZoom((current) =>
                        Math.max(MIN_GRID_ZOOM, Number((current - 0.06).toFixed(2))),
                      )
                    }
                  >
                    <Text style={styles.zoomButtonText}>-</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.zoomValue, gridZoom >= MAX_GRID_ZOOM ? styles.zoomButtonDisabled : null]}
                    disabled={gridZoom >= MAX_GRID_ZOOM}
                    onPress={() => setGridZoom(MAX_GRID_ZOOM)}
                  >
                    <Text style={styles.zoomValueText}>{Math.round(gridZoom * 100)}%</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.zoomButton, gridZoom >= MAX_GRID_ZOOM ? styles.zoomButtonDisabled : null]}
                    disabled={gridZoom >= MAX_GRID_ZOOM}
                    onPress={() =>
                      setGridZoom((current) =>
                        Math.min(MAX_GRID_ZOOM, Number((current + 0.06).toFixed(2))),
                      )
                    }
                  >
                    <Text style={styles.zoomButtonText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </View>

        {scannerOpen ? (
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerCard}>
              <View style={styles.scannerHeader}>
                <Text style={styles.scannerTitle}>Escanear código de barras</Text>
                <Pressable style={styles.scannerCloseButton} onPress={() => setScannerOpen(false)}>
                  <Text style={styles.scannerCloseText}>Cerrar</Text>
                </Pressable>
              </View>
              <Text style={styles.scannerHint}>Apunta la cámara al código de barras de la etiqueta.</Text>
              <View style={styles.scannerCameraWrap}>
                {cameraDevice && hasCameraPermission ? (
                  <>
                    <Camera
                      style={StyleSheet.absoluteFill}
                      device={cameraDevice}
                      isActive={scannerOpen}
                      codeScanner={codeScanner}
                    />
                    <View style={styles.scannerFrame} pointerEvents="none" />
                  </>
                ) : (
                  <View style={styles.scannerUnavailable}>
                    <Text style={styles.scannerUnavailableText}>No se pudo activar la cámara.</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ) : null}

        {userMenuVisible ? (
          <View
            style={[
              styles.menuOverlay,
              menuOverlayInsetsStyle,
            ]}
          >
            <Pressable style={styles.menuBackdrop} onPress={closeUserMenu} />
            <Animated.View
              style={[
                styles.userMenuPanel,
                {
                  transform: [
                    {
                      translateX: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [24, 0],
                      }),
                    },
                  ],
                  opacity: slideAnim,
                },
              ]}
            >
              <View style={styles.userMenuHeader}>
                <View>
                  <Text style={styles.userMenuKicker}>Acciones de caja</Text>
                  <Text style={styles.userMenuName}>{user?.name ?? 'Usuario POS'}</Text>
                  <Text style={styles.userMenuRole}>{user?.role ?? 'Administrador'}</Text>
                  <Text style={styles.userMenuStation}>
                    Estación principal: {parentStationLabel?.trim() || 'No vinculada'}
                  </Text>
                </View>
                <View style={styles.userMenuAvatar}>
                  <Text style={styles.userMenuAvatarText}>{userInitials}</Text>
                </View>
              </View>

              <ScrollView style={styles.userMenuList} contentContainerStyle={styles.userMenuListContent}>
                <MenuItem
                  label="Historial"
                  meta="Ventas registradas"
                  icon="🧾"
                  onPress={openHistoryPage}
                />
                <MenuItem label="Configurar impresora" meta="Pendiente" icon="🖨️" />
                <View style={styles.userMenuDivider} />
                <MenuItem
                  label="Cerrar sesion"
                  meta="Volver a ingresar"
                  icon="🚪"
                  danger
                  onPress={() => {
                    closeUserMenu();
                    releaseReservation(reservedSaleId).catch(() => undefined);
                    logout();
                  }}
                />
              </ScrollView>

              <View style={styles.userMenuFooter}>
                <Text style={styles.userMenuFooterKicker}>Hora actual</Text>
                <Text style={styles.userMenuFooterValue}>{bogotaTimeLabel}</Text>
                <Text style={styles.userMenuFooterVersion}>{APP_VERSION_LABEL}</Text>
              </View>
            </Animated.View>
          </View>
        ) : null}

        {actionToast ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.actionToastWrap,
              { top: Math.max(insets.top + 10, 24) },
              {
                opacity: toastAnim,
                transform: [
                  {
                    translateY: toastAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.actionToastCard,
                actionToastTone === 'error' ? styles.actionToastCardError : styles.actionToastCardInfo,
              ]}
            >
              <Text
                style={[
                  styles.actionToastTitle,
                  actionToastTone === 'error' ? styles.actionToastTitleError : styles.actionToastTitleInfo,
                ]}
              >
                {actionToastTone === 'error' ? 'No se puede continuar' : 'Listo'}
              </Text>
              <Text style={styles.actionToastMessage}>{actionToast}</Text>
            </View>
          </Animated.View>
        ) : null}

        {customerModalOpen ? (
          <DismissKeyboardOverlay
            behavior={modalKeyboardBehavior}
            keyboardVerticalOffset={modalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.customerCard, modalCompact ? styles.modalCardCompactLarge : null]}>
              <View style={styles.customerHeader}>
                <View>
                  <Text style={styles.customerKicker}>Cliente</Text>
                  <Text style={styles.customerTitle}>
                    {customerMode === 'list' ? 'Buscar o asignar cliente' : 'Nuevo cliente'}
                  </Text>
                </View>
                <Pressable
                  style={styles.customerCloseButton}
                  onPress={handleCloseCustomerModal}
                >
                  <Text style={styles.customerCloseText}>×</Text>
                </Pressable>
              </View>

              <View style={styles.customerModeRow}>
                <Pressable
                  style={[styles.customerModeButton, customerMode === 'list' ? styles.customerModeButtonActive : null]}
                  onPress={() => {
                    setCustomerMode('list');
                    setCustomerError(null);
                    setCustomerPage(0);
                  }}
                >
                  <Text style={styles.customerModeButtonText}>Buscar</Text>
                </Pressable>
                <Pressable
                  style={[styles.customerModeButton, customerMode === 'new' ? styles.customerModeButtonActive : null]}
                  onPress={() => {
                    setCustomerMode('new');
                    setCustomerError(null);
                    setPendingCustomerSelection(null);
                    setCustomerPage(0);
                  }}
                >
                  <Text style={styles.customerModeButtonText}>Nuevo cliente</Text>
                </Pressable>
              </View>

              {customerMode === 'list' ? (
                <>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerSearch}
                      onChangeText={handleCustomerSearchChange}
                      style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                      placeholder="Buscar por nombre, teléfono o NIT"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <ScrollView style={styles.customerList} contentContainerStyle={styles.customerListContent}>
                    {!customerListReady || customerLoading ? (
                      <Text style={styles.customerStateText}>Cargando clientes...</Text>
                    ) : customerResults.length === 0 ? (
                      <Text style={styles.customerStateText}>No encontramos clientes.</Text>
                    ) : (
                      customerResults.map((customer) => {
                        const isSelected = selectedCustomer?.id === customer.id;
                        return (
                          <Pressable
                            key={customer.id}
                            style={[styles.customerRow, isSelected ? styles.customerRowSelected : null]}
                            onPress={() => setPendingCustomerSelection(customer)}
                          >
                            <View style={styles.customerRowMain}>
                              <Text style={styles.customerRowName}>{customer.name}</Text>
                              <Text style={styles.customerRowMeta}>
                                {customer.phone?.trim() || 'Sin teléfono'}
                                {customer.tax_id?.trim() ? ` · ${customer.tax_id.trim()}` : ''}
                              </Text>
                            </View>
                            {isSelected ? <Text style={styles.customerBadge}>Actual</Text> : null}
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                  <View style={styles.customerPagerRow}>
                    <Pressable
                      style={[styles.customerPagerButton, customerPage <= 0 ? styles.customerPagerButtonDisabled : null]}
                      disabled={customerPage <= 0 || customerLoading}
                      onPress={() => setCustomerPage((current) => Math.max(0, current - 1))}
                    >
                      <Text style={styles.customerPagerButtonText}>Anterior</Text>
                    </Pressable>
                    <Text style={styles.customerPagerText}>Página {customerPage + 1}</Text>
                    <Pressable
                      style={[styles.customerPagerButton, !customerHasMore ? styles.customerPagerButtonDisabled : null]}
                      disabled={!customerHasMore || customerLoading}
                      onPress={() => setCustomerPage((current) => current + 1)}
                    >
                      <Text style={styles.customerPagerButtonText}>Siguiente</Text>
                    </Pressable>
                  </View>
                  <View style={styles.customerActions}>
                    <Pressable
                      style={styles.quantityCancel}
                      onPress={() => {
                        setSelectedCustomer(null);
                        setPendingCustomerSelection(null);
                        showActionToast('Cliente removido de la venta.');
                      }}
                    >
                      <Text style={styles.quantityCancelText}>Quitar cliente</Text>
                    </Pressable>
                    <Pressable
                      style={styles.quantityApply}
                      onPress={handleCloseCustomerModal}
                    >
                      <Text style={styles.quantityApplyText}>Listo</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerForm.name}
                      onChangeText={(value) =>
                        setCustomerForm((prev) => ({ ...prev, name: value }))
                      }
                      style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                      placeholder="Nombre completo *"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerForm.phone}
                      onChangeText={(value) =>
                        setCustomerForm((prev) => ({ ...prev, phone: value }))
                      }
                      keyboardType="phone-pad"
                      style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                      placeholder="Teléfono"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerForm.email}
                      onChangeText={(value) =>
                        setCustomerForm((prev) => ({ ...prev, email: value }))
                      }
                      keyboardType="email-address"
                      autoCapitalize="none"
                      style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                      placeholder="Email"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerForm.taxId}
                      onChangeText={(value) =>
                        setCustomerForm((prev) => ({ ...prev, taxId: value }))
                      }
                      style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                      placeholder="NIT / Documento"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      value={customerForm.address}
                      onChangeText={(value) =>
                        setCustomerForm((prev) => ({ ...prev, address: value }))
                      }
                      style={styles.discountInput}
                      placeholder="Dirección"
                      placeholderTextColor="#7282a3"
                    />
                  </View>
                  <View style={styles.customerActions}>
                    <Pressable style={styles.quantityCancel} onPress={handleCloseCustomerModal}>
                      <Text style={styles.quantityCancelText}>Cancelar</Text>
                    </Pressable>
                    <Pressable
                      style={styles.quantityApply}
                      onPress={() => {
                        handleCreateCustomer().catch(() => undefined);
                      }}
                    >
                      <Text style={styles.quantityApplyText}>
                        {customerSaving ? 'Guardando...' : 'Guardar y asignar'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}

              {customerError ? <Text style={styles.customerErrorText}>{customerError}</Text> : null}
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {pendingCustomerSelection ? (
          <DismissKeyboardOverlay
            behavior={modalKeyboardBehavior}
            keyboardVerticalOffset={modalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={styles.customerConfirmCard}>
              <Text style={styles.quantityTitle}>¿Asignar este cliente?</Text>
              <Text style={styles.customerConfirmName}>{pendingCustomerSelection.name}</Text>
              <Text style={styles.customerConfirmMeta}>
                {pendingCustomerSelection.phone?.trim() || 'Sin teléfono'}
                {pendingCustomerSelection.email?.trim() ? ` · ${pendingCustomerSelection.email.trim()}` : ''}
                {pendingCustomerSelection.tax_id?.trim() ? ` · ${pendingCustomerSelection.tax_id.trim()}` : ''}
              </Text>
              <View style={styles.quantityActions}>
                <Pressable
                  style={styles.quantityCancel}
                  onPress={() => setPendingCustomerSelection(null)}
                >
                  <Text style={styles.quantityCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable style={styles.quantityApply} onPress={handleConfirmAssignCustomer}>
                  <Text style={styles.quantityApplyText}>Sí, asignar</Text>
                </Pressable>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {discountModalOpen ? (
          <DismissKeyboardOverlay
            behavior={modalKeyboardBehavior}
            keyboardVerticalOffset={modalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.quantityCard, styles.discountCard, modalCompact ? styles.discountCardCompact : null]}>
              <View style={[styles.modalHeader, styles.discountHeader]}>
                <Pressable style={styles.modalCloseButton} onPress={() => setDiscountModalOpen(false)}>
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </Pressable>
                <Text
                  style={[styles.modalTitleText, styles.discountTitle, modalCompact ? styles.modalTitleTextCompact : null]}
                  numberOfLines={2}
                >
                  {discountScope === 'item' ? 'Descuento por artículo' : 'Descuento al carrito'}
                </Text>
              </View>
              <View style={[styles.discountModeRow, styles.discountModeRowSpacious]}>
                <Pressable
                  style={[styles.discountModeButton, discountScope === 'item' ? styles.discountModeButtonActive : null]}
                  onPress={() => handleSelectDiscountScope('item')}
                >
                  <Text style={styles.discountModeButtonText}>Artículo</Text>
                </Pressable>
                <Pressable
                  style={[styles.discountModeButton, discountScope === 'cart' ? styles.discountModeButtonActive : null]}
                  onPress={() => handleSelectDiscountScope('cart')}
                >
                  <Text style={styles.discountModeButtonText}>Carrito</Text>
                </Pressable>
              </View>
              <View style={[styles.discountModeRow, styles.discountModeRowSpacious]}>
                <Pressable
                  style={[styles.discountModeButton, discountMode === 'value' ? styles.discountModeButtonActive : null]}
                  onPress={() => {
                    setDiscountMode('value');
                    setDiscountInput((current) => formatPriceInputValue(current));
                  }}
                >
                  <Text style={styles.discountModeButtonText}>Valor $</Text>
                </Pressable>
                <Pressable
                  style={[styles.discountModeButton, discountMode === 'percent' ? styles.discountModeButtonActive : null]}
                  onPress={() => {
                    setDiscountMode('percent');
                    setDiscountInput((current) => current.replace(/\./g, ''));
                  }}
                >
                  <Text style={styles.discountModeButtonText}>%</Text>
                </Pressable>
              </View>
              <View style={[styles.discountInputWrap, styles.discountInputWrapLarge, modalCompact ? styles.discountInputWrapCompact : null]}>
                <TextInput
                  value={discountInput}
                  onChangeText={handleDiscountInputChange}
                  keyboardType={discountMode === 'value' ? 'number-pad' : 'decimal-pad'}
                  style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                  placeholder={discountMode === 'value' ? 'Cantidad a descontar' : 'Porcentaje a descontar'}
                  placeholderTextColor="#7282a3"
                />
              </View>
              <View style={[styles.modalFooter, styles.discountFooter]}>
                <View style={[styles.quantityActions, modalCompact ? styles.quantityActionsCompact : null]}>
                  <Pressable style={styles.quantityCancel} onPress={() => setDiscountModalOpen(false)}>
                    <Text style={styles.quantityCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityCancel} onPress={handleClearDiscount}>
                    <Text style={styles.quantityCancelText}>Quitar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityApply} onPress={handleApplyDiscount}>
                    <Text style={styles.quantityApplyText}>Aplicar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {showSyncModal ? (
          <View style={styles.syncModalBackdrop}>
            <View style={styles.syncModalCard}>
              <Text style={styles.syncModalTitle}>Estado conexión</Text>
              <View style={styles.syncModalStatusRow}>
                <View style={[styles.syncDot, { backgroundColor: syncMeta.color }]} />
                <Text style={styles.syncModalStatusText}>{syncMeta.label}</Text>
              </View>
              <Text style={styles.syncModalLine}>Última sincronización: {lastSyncText}</Text>
              <Text style={styles.syncModalLine}>Último chequeo: {lastCheckText}</Text>
              {syncReason ? (
                <Text style={styles.syncModalLine} numberOfLines={2}>
                  Detalle: {syncReason}
                </Text>
              ) : null}

              <View style={styles.syncModalActions}>
                <Pressable style={styles.syncModalCloseButton} onPress={() => setShowSyncModal(false)}>
                  <Text style={styles.syncModalCloseText}>Cerrar</Text>
                </Pressable>
                <Pressable
                  style={styles.syncModalRefreshButton}
                  onPress={() => {
                    handleRefreshSync().catch(() => undefined);
                  }}
                  disabled={refreshingSync}
                >
                  {refreshingSync ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.syncModalRefreshText}>Revalidar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {syncStatus === 'offline' ? (
          <View style={styles.offlineOverlay}>
            <View style={styles.offlineCard}>
              <View style={[styles.syncDot, { backgroundColor: SYNC_COLORS.offline }]} />
              <Text style={styles.offlineTitle}>Sin conexión con la API</Text>
              <Text style={styles.offlineBody}>La estación está bloqueada hasta recuperar conexión.</Text>
              {syncReason ? <Text style={styles.offlineDetail}>Detalle: {syncReason}</Text> : null}
              <Pressable
                style={styles.offlineAction}
                onPress={() => {
                  handleRefreshSync().catch(() => undefined);
                }}
                disabled={refreshingSync}
              >
                {refreshingSync ? (
                  <ActivityIndicator size="small" color="#031424" />
                ) : (
                  <Text style={styles.offlineActionText}>Revalidar conexión</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {successSale ? (
          <View style={styles.successOverlay}>
            <View style={styles.successCard}>
              <View style={styles.successHeader}>
                <Text style={styles.successKicker}>Venta registrada correctamente</Text>
                <Text style={styles.successTitle}>Venta completada con éxito</Text>
                <Text style={styles.successSubtitle}>
                  Selecciona cómo deseas entregar el recibo al cliente.
                </Text>
              </View>

              <ScrollView
                style={styles.successBody}
                contentContainerStyle={styles.successBodyContent}
                showsVerticalScrollIndicator
              >
                <View style={styles.successSummary}>
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>Documento</Text>
                    <Text style={styles.successValue}>{successSale.documentNumber}</Text>
                  </View>
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>Ticket</Text>
                    <Text style={styles.successValue}>#{successSale.saleNumber}</Text>
                  </View>
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>Subtotal</Text>
                    <Text style={styles.successValue}>{formatMoney(successSale.subtotal)}</Text>
                  </View>
                  {successSale.lineDiscountTotal > 0 ? (
                    <View style={styles.successRow}>
                      <Text style={styles.successLabelAccent}>Descuento artículos</Text>
                      <Text style={styles.successValueAccent}>
                        -{formatMoney(successSale.lineDiscountTotal)}
                      </Text>
                    </View>
                  ) : null}
                  {successSale.cartDiscountValueDisplay !== '0' ? (
                    <View style={styles.successRow}>
                      <Text style={styles.successLabel}>{successSale.cartDiscountLabel}</Text>
                      <Text style={styles.successValue}>{successSale.cartDiscountValueDisplay}</Text>
                    </View>
                  ) : null}
                  {successSale.surchargeLabel && successSale.surchargeValueDisplay ? (
                    <View style={styles.successRow}>
                      <Text style={styles.successLabelWarn}>{successSale.surchargeLabel}</Text>
                      <Text style={styles.successValueWarn}>+{successSale.surchargeValueDisplay}</Text>
                    </View>
                  ) : null}
                  <View style={styles.successRow}>
                    <Text style={styles.successLabel}>Total pagado</Text>
                    <Text style={styles.successValueTotal}>{formatMoney(successSale.total)}</Text>
                  </View>
                  {successSale.showChange && successSale.changeAmount > 0 ? (
                    <View style={styles.successRow}>
                      <Text style={styles.successLabelWarn}>Cambio</Text>
                      <Text style={styles.successValueWarn}>{formatMoney(successSale.changeAmount)}</Text>
                    </View>
                  ) : null}
                  {successSale.payments.length ? (
                    <View style={styles.successPayments}>
                      {successSale.payments.map((payment, index) => (
                        <View key={`${payment.label}-${index}`} style={styles.successRow}>
                          <Text style={styles.successLabel}>Pago · {payment.label}</Text>
                          <Text style={styles.successValue}>{formatMoney(payment.amount)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {successSale.notes ? (
                    <View style={styles.successNotes}>
                      <Text style={styles.successNotesLabel}>Notas</Text>
                      <Text style={styles.successNotesText}>{successSale.notes}</Text>
                    </View>
                  ) : null}
                  {successSale.customer ? (
                    <View style={styles.successNotes}>
                      <Text style={styles.successNotesLabel}>Cliente</Text>
                      <Text style={styles.successNotesText}>{successSale.customer.name}</Text>
                      {successSale.customer.phone ? (
                        <Text style={styles.successNotesText}>Tel: {successSale.customer.phone}</Text>
                      ) : null}
                      {successSale.customer.email ? (
                        <Text style={styles.successNotesText}>Email: {successSale.customer.email}</Text>
                      ) : null}
                      {successSale.customer.taxId ? (
                        <Text style={styles.successNotesText}>NIT/ID: {successSale.customer.taxId}</Text>
                      ) : null}
                      {successSale.customer.address ? (
                        <Text style={styles.successNotesText}>Dirección: {successSale.customer.address}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </ScrollView>

              <View style={styles.successActions}>
                <Pressable
                  style={styles.successActionMock}
                  onPress={() => {
                    handleOpenSaleDocument('ticket').catch(() => undefined);
                  }}
                >
                  <Text style={styles.successActionMockText}>Imprimir ticket</Text>
                </Pressable>
                <Pressable
                  style={styles.successActionMock}
                  onPress={() => {
                    handleSendSaleDocumentByEmail('ticket').catch(() => undefined);
                  }}
                >
                  <Text style={styles.successActionMockText}>Enviar ticket</Text>
                </Pressable>
                <Pressable
                  style={styles.successActionMock}
                  onPress={() => {
                    handleSendSaleDocumentByEmail('invoice').catch(() => undefined);
                  }}
                >
                  <Text style={styles.successActionMockText}>Enviar factura</Text>
                </Pressable>
                <Pressable style={styles.successActionDone} onPress={handleSuccessDone}>
                  <Text style={styles.successActionDoneText}>Hecho (volver al POS)</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {paymentView !== 'none' ? (
          <View style={styles.paymentPageOverlay}>
            <PaymentPage
              mode={paymentView}
              saleNumberLabel={String(reservedSaleNumber ?? currentSaleNumber ?? '--')}
              totalToPay={cartTotal}
              cart={cart.map((item) => ({
                id: item.id,
                name: item.product.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineDiscountValue: item.lineDiscountValue,
                lineTotal: calcLineTotal(item),
                freeSaleReason: item.freeSaleReason,
              }))}
              cartGrossSubtotal={cartGrossSubtotal}
              cartLineDiscountTotal={cartLineDiscountTotal}
              cartSubtotal={cartSubtotal}
              cartDiscountValue={cartDiscountValue}
              cartDiscountPercent={cartDiscountPercent}
              surchargeEnabled={cartSurcharge.enabled}
              surchargeAmount={cartSurcharge.amount}
              surchargeLabel={`Incremento${cartSurcharge.method ? ` ${getSurchargeMethodLabel(cartSurcharge.method)}` : ''}`}
              saleNotes={saleNotes}
              selectedCustomer={
                selectedCustomer
                  ? {
                      name: selectedCustomer.name,
                      phone: selectedCustomer.phone ?? null,
                      email: selectedCustomer.email ?? null,
                      taxId: selectedCustomer.tax_id ?? null,
                    }
                  : null
              }
              paymentMethods={activePaymentMethods}
              selectedMethod={paymentMethod}
              separatedPaymentMethod={separatedPaymentMethod}
              separatedMethodOptions={separatedMethodOptions}
              inputValue={paymentView === 'single' ? paymentValue : paymentLineInput}
              requiresManualAmount={requiresManualAmount}
              displayChangeLabel={singleDisplayLabel}
              displayChange={singleDisplayAmount}
              multipleLines={paymentLines}
              selectedLineId={selectedPaymentLineId}
              multipleTotalPaid={paymentMultipleTotal}
              multipleDiff={paymentMultipleDiff}
              multipleBadgeLabel={paymentMultipleBadgeLabel}
              multipleBadgeAmount={paymentMultipleBadgeAmount}
              isSubmitting={paymentSubmitting}
              confirmDisabled={paymentView === 'single' ? paymentSingleConfirmDisabled : paymentMultipleConfirmDisabled}
              errorText={paymentError}
              onBack={() => {
                handleCancelPaymentScreen().catch(() => undefined);
              }}
              onOpenCustomerModal={handleOpenCustomerModal}
              onConfirm={() => {
                handleConfirmPayment().catch(() => undefined);
              }}
              onConfirmBlocked={() => {
                const reason = getPaymentBlockedReason({
                  paymentSubmitting,
                  paymentView,
                  cartTotal,
                  allowsChange,
                  paymentSinglePaid,
                  paymentMultipleTotal,
                  paymentMultipleRemaining,
                });
                if (reason) {
                  showActionToast(reason, 2600, 'error');
                }
              }}
              onGoMultiple={handleSetMultipleMode}
              onGoSingle={handleSetSingleMode}
              onSelectMethod={handleSelectPaymentMethod}
              onSelectSeparatedMethod={setSeparatedPaymentMethod}
              onSelectLineSeparatedMethod={handleSetSeparatedMethodForLine}
              onChangeAmountInput={paymentView === 'single' ? handleSinglePaymentAmountChange : handlePaymentLineAmountChange}
              onChangeNotes={setSaleNotes}
              onClearNotes={() => setSaleNotes('')}
              onAddNotePreset={(note) => setSaleNotes((prev) => (prev ? `${prev}\n${note}` : note))}
              onSelectLine={handleSelectPaymentLine}
              onDeleteLine={handleDeletePaymentLine}
            />
          </View>
        ) : null}

        {surchargeModalOpen ? (
          <DismissKeyboardOverlay
            behavior={modalKeyboardBehavior}
            keyboardVerticalOffset={modalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.surchargeCard, modalCompact ? styles.modalCardCompactLarge : null]}>
              <View style={styles.modalHeader}>
                <Pressable style={styles.modalCloseButton} onPress={handleCloseSurchargeModal}>
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </Pressable>
                <Text
                  style={[styles.modalTitleText, modalCompact ? styles.modalTitleTextCompact : null]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Incremento
                </Text>
              </View>
              <Text style={styles.surchargeHint}>
                {cartTotalBeforeSurcharge > 0
                  ? `Base actual: ${formatMoney(cartTotalBeforeSurcharge)}`
                  : 'Sin productos: puedes dejar el incremento configurado para cuando agregues artículos.'}
              </Text>
              <View style={styles.surchargePresetRow}>
                <Pressable style={styles.surchargePresetButton} onPress={() => handleApplySurchargePreset('addi')}>
                  <Text style={styles.discountModeButtonText}>
                    Addi 10%
                  </Text>
                  <Text style={styles.surchargePresetAmount}>
                    {formatMoney(roundUpToThousand(cartTotalBeforeSurcharge * 0.1))}
                  </Text>
                </Pressable>
                <Pressable style={styles.surchargePresetButton} onPress={() => handleApplySurchargePreset('sistecredito')}>
                  <Text style={styles.discountModeButtonText}>
                    Sistecrédito 5%
                  </Text>
                  <Text style={styles.surchargePresetAmount}>
                    {formatMoney(roundUpToThousand(cartTotalBeforeSurcharge * 0.05))}
                  </Text>
                </Pressable>
              </View>
              <View style={[styles.surchargeInputWrap, modalCompact ? styles.discountInputWrapCompact : null]}>
                <TextInput
                  value={customSurchargeValue.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  onChangeText={(value) => setCustomSurchargeValue(value.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                  placeholder="Valor manual (ej. 50.000)"
                  placeholderTextColor="#7282a3"
                />
              </View>
              <View style={[styles.surchargeInputWrap, modalCompact ? styles.discountInputWrapCompact : null]}>
                <TextInput
                  value={customSurchargePercent}
                  onChangeText={(value) => setCustomSurchargePercent(value.replace(/[^\d]/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                  placeholder="Porcentaje manual"
                  placeholderTextColor="#7282a3"
                />
              </View>
              <View style={styles.modalFooter}>
                <View style={[styles.surchargeActions, modalCompact ? styles.quantityActionsCompact : null]}>
                  <Pressable style={styles.quantityCancel} onPress={handleCloseSurchargeModal}>
                    <Text style={styles.quantityCancelText}>Cerrar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityCancel} onPress={handleDeactivateSurcharge}>
                    <Text style={styles.quantityCancelText}>Desactivar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityApply} onPress={handleApplyManualSurcharge}>
                    <Text style={styles.quantityApplyText}>Aplicar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {freeSaleReasonModalOpen ? (
          <DismissKeyboardOverlay
            behavior={freeSaleModalKeyboardBehavior}
            keyboardVerticalOffset={freeSaleModalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.quantityCard, modalCompact ? styles.modalCardCompact : null]}>
              <View style={styles.modalHeader}>
                <Pressable
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setFreeSaleReasonModalOpen(false);
                    setFreeSaleReasonTargetCartId(null);
                    setFreeSaleReasonProduct(null);
                    setFreeSaleReasonValue('');
                    setPendingFreeSaleReason(null);
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </Pressable>
                <Text
                  style={[styles.modalTitleText, modalCompact ? styles.modalTitleTextCompact : null]}
                  numberOfLines={2}
                >
                  Motivo venta libre
                </Text>
              </View>
              {freeSaleReasonProduct ? (
                <Text style={styles.modalSubtitleText} numberOfLines={2}>
                  {freeSaleReasonProduct.name}
                </Text>
              ) : null}
              <View style={[styles.discountInputWrap, modalCompact ? styles.discountInputWrapCompact : null]}>
                <TextInput
                  value={freeSaleReasonValue}
                  onChangeText={setFreeSaleReasonValue}
                  style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                  placeholder="Escribe el motivo"
                  placeholderTextColor="#7282a3"
                />
              </View>
              <View style={styles.modalFooter}>
                <View style={[styles.quantityActions, modalCompact ? styles.quantityActionsCompact : null]}>
                  <Pressable
                    style={styles.quantityCancel}
                    onPress={() => {
                      setFreeSaleReasonModalOpen(false);
                      setFreeSaleReasonTargetCartId(null);
                      setFreeSaleReasonProduct(null);
                      setFreeSaleReasonValue('');
                      setPendingFreeSaleReason(null);
                    }}
                  >
                    <Text style={styles.quantityCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityApply} onPress={handleApplyFreeSaleReason}>
                    <Text style={styles.quantityApplyText}>Guardar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {priceChangeProduct ? (
          <DismissKeyboardOverlay
            behavior={freeSaleModalKeyboardBehavior}
            keyboardVerticalOffset={freeSaleModalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.quantityCard, modalCompact ? styles.modalCardCompact : null]}>
              <View style={styles.modalHeader}>
                <Pressable
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setPriceChangeProduct(null);
                    setPriceChangeValue('0');
                    setPendingFreeSaleReason(null);
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </Pressable>
                <Text
                  style={[styles.modalTitleText, modalCompact ? styles.modalTitleTextCompact : null]}
                  numberOfLines={2}
                >
                  Cambiar precio
                </Text>
              </View>
              <Text style={styles.modalSubtitleText} numberOfLines={2}>
                {priceChangeProduct.name}
              </Text>
              <View style={[styles.discountInputWrap, modalCompact ? styles.discountInputWrapCompact : null]}>
                <TextInput
                  value={priceChangeValue}
                  onChangeText={handlePriceChangeInput}
                  keyboardType="number-pad"
                  style={[styles.discountInput, modalCompact ? styles.discountInputCompact : null]}
                  placeholder="Nuevo precio"
                  placeholderTextColor="#7282a3"
                  autoFocus={Boolean(pendingFreeSaleReason)}
                  selectTextOnFocus
                />
              </View>
              <View style={styles.modalFooter}>
                <View style={[styles.quantityActions, modalCompact ? styles.quantityActionsCompact : null]}>
                  <Pressable
                    style={styles.quantityCancel}
                    onPress={() => {
                      setPriceChangeProduct(null);
                      setPriceChangeValue('0');
                      setPendingFreeSaleReason(null);
                    }}
                  >
                    <Text style={styles.quantityCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityApply} onPress={handleApplyPriceChange}>
                    <Text style={styles.quantityApplyText}>Aplicar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}

        {quantityModalOpen ? (
          <DismissKeyboardOverlay
            behavior={modalKeyboardBehavior}
            keyboardVerticalOffset={modalKeyboardOffset}
            keyboardHeight={keyboardHeight}
          >
            <View style={[styles.quantityCard, modalCompact ? styles.modalCardCompact : null]}>
              <View style={styles.modalHeader}>
                <Pressable style={styles.modalCloseButton} onPress={() => setQuantityModalOpen(false)}>
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </Pressable>
                <Text
                  style={[styles.modalTitleText, modalCompact ? styles.modalTitleTextCompact : null]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  Cambiar cantidad
                </Text>
              </View>
              <View style={[styles.quantityControls, modalCompact ? styles.quantityControlsCompact : null]}>
                <Pressable
                  style={[styles.quantityStepper, modalCompact ? styles.quantityStepperCompact : null]}
                  onPress={() => adjustQuantityValue(-1)}
                >
                  <Text style={[styles.quantityStepperText, modalCompact ? styles.quantityStepperTextCompact : null]}>-</Text>
                </Pressable>
                <View style={[styles.quantityInputWrap, modalCompact ? styles.quantityInputWrapCompact : null]}>
                  <TextInput
                    value={quantityValue}
                    onChangeText={(value) => setQuantityValue(value.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    style={[styles.quantityInput, modalCompact ? styles.quantityInputCompact : null]}
                    placeholder="1"
                    placeholderTextColor="#7282a3"
                  />
                </View>
                <Pressable
                  style={[styles.quantityStepper, modalCompact ? styles.quantityStepperCompact : null]}
                  onPress={() => adjustQuantityValue(1)}
                >
                  <Text style={[styles.quantityStepperText, modalCompact ? styles.quantityStepperTextCompact : null]}>+</Text>
                </Pressable>
              </View>
              <View style={styles.modalFooter}>
                <View style={[styles.quantityActions, modalCompact ? styles.quantityActionsCompact : null]}>
                  <Pressable style={styles.quantityCancel} onPress={() => setQuantityModalOpen(false)}>
                    <Text style={styles.quantityCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.quantityApply} onPress={handleApplyQuantity}>
                    <Text style={styles.quantityApplyText}>Aplicar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </DismissKeyboardOverlay>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function MenuItem({
  icon,
  label,
  meta,
  danger,
  onPress,
}: {
  icon: string;
  label: string;
  meta: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.userMenuItem} onPress={onPress}>
      <View style={styles.userMenuItemLeft}>
        <Text style={styles.userMenuItemIcon}>{icon}</Text>
        <Text style={[styles.userMenuItemLabel, danger ? styles.userMenuItemLabelDanger : null]}>
          {label}
        </Text>
      </View>
      <Text style={[styles.userMenuItemMeta, danger ? styles.userMenuItemMetaDanger : null]}>
        {meta}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030918',
  },
  container: {
    flex: 1,
    backgroundColor: '#030918',
    paddingTop: 8,
  },
  paymentPageOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  topBar: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#173057',
    backgroundColor: '#07152b',
    paddingLeft: 16,
    paddingRight: 20,
    paddingTop: 6,
  },
  actionsRow: {
    gap: 10,
    paddingVertical: 7,
    paddingRight: 16,
  },
  actionButton: {
    minWidth: 104,
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#203459',
    backgroundColor: '#13203b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  actionButtonDanger: {
    backgroundColor: '#ff1e4f',
    borderColor: '#ff1e4f',
  },
  actionButtonAccent: {
    borderColor: '#e2b31f',
  },
  actionButtonText: {
    color: '#dfe8f7',
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonTextDanger: {
    color: '#ffffff',
  },
  actionButtonTextAccent: {
    color: '#f6d35b',
  },
  topBarMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingLeft: 16,
  },
  syncButton: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#2d4c7f',
    backgroundColor: '#0f1f3b',
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncButtonAlert: {
    borderColor: '#d9b24b',
    backgroundColor: '#1f2433',
  },
  syncButtonDisabled: {
    opacity: 0.75,
  },
  syncButtonText: {
    color: '#f1f6ff',
    fontSize: 15,
    fontWeight: '700',
  },
  syncButtonBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f4c54f',
    marginLeft: 2,
  },
  syncChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#274166',
    backgroundColor: '#0d1a31',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  syncModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  syncModalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#314a72',
    backgroundColor: '#0b162b',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  syncModalTitle: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  syncModalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  syncModalStatusText: {
    color: '#dce8fa',
    fontSize: 15,
    fontWeight: '700',
  },
  syncModalLine: {
    color: '#9bb0ce',
    fontSize: 13,
    marginBottom: 6,
  },
  syncModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  syncModalCloseButton: {
    minWidth: 110,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#12223e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  syncModalCloseText: {
    color: '#e4eefc',
    fontSize: 14,
    fontWeight: '700',
  },
  syncModalRefreshButton: {
    minWidth: 122,
    height: 42,
    borderRadius: 11,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  syncModalRefreshText: {
    color: '#031424',
    fontSize: 14,
    fontWeight: '800',
  },
  offlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 85,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  offlineCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ad334b',
    backgroundColor: '#2b1019',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  offlineTitle: {
    color: '#ffe5ec',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 10,
    textAlign: 'center',
  },
  offlineBody: {
    color: '#fbc6d3',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  offlineDetail: {
    color: '#fbc6d3',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  offlineAction: {
    marginTop: 14,
    minWidth: 210,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  offlineActionText: {
    color: '#031424',
    fontSize: 14,
    fontWeight: '800',
  },
  userSummary: {
    alignItems: 'flex-end',
  },
  userName: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  userRole: {
    color: '#94a8c7',
    fontSize: 13,
    marginTop: 2,
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a2945',
    borderWidth: 1,
    borderColor: '#2b426c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#f8fbff',
    fontSize: 17,
    fontWeight: '800',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  cartColumn: {
    width: 328,
    borderRightWidth: 1,
    borderRightColor: '#163056',
    backgroundColor: '#061226',
  },
  resizeHandle: {
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#071325',
  },
  resizeHandleLine: {
    width: 4,
    height: '28%',
    minHeight: 88,
    borderRadius: 999,
    backgroundColor: '#1b365f',
  },
  cartMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#163056',
    backgroundColor: '#0a1933',
  },
  cartTitle: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  cartSaleNo: {
    color: '#adc2dd',
    fontSize: 12,
  },
  cartCustomerInfo: {
    color: '#74e6c0',
    fontSize: 11,
    marginTop: 3,
    maxWidth: 180,
  },
  cartCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  cartCustomerRemoveButton: {
    marginTop: 2,
    minHeight: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d4f7c',
    backgroundColor: '#11253f',
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCustomerRemoveText: {
    color: '#d8e6fb',
    fontSize: 10,
    fontWeight: '700',
  },
  cartLines: {
    color: '#adc2dd',
    fontSize: 12,
    paddingTop: 5,
  },
  saleNoticeWrap: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1ea587',
    backgroundColor: 'rgba(25,210,149,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  saleNoticeText: {
    color: '#9ff7d9',
    fontSize: 12,
    fontWeight: '600',
  },
  cartItemsEmpty: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  cartItemsList: {
    flex: 1,
  },
  cartItemsContent: {
    flexGrow: 1,
  },
  cartEmptyText: {
    color: '#7187a6',
    fontSize: 18,
    fontWeight: '500',
  },
  cartItemRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#163056',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cartItemRowSelected: {
    backgroundColor: '#11315b',
  },
  cartItemMain: {
    flex: 1,
  },
  cartItemName: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  cartItemMeta: {
    color: '#9eb3d0',
    fontSize: 12,
    marginTop: 2,
  },
  cartItemPriceWrap: {
    alignItems: 'flex-end',
    minWidth: 92,
  },
  cartItemPrice: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '800',
  },
  cartItemPriceMuted: {
    color: '#7282a3',
    fontSize: 12,
    textDecorationLine: 'line-through',
    marginBottom: 3,
  },
  cartItemDiscount: {
    color: '#67e8b2',
    fontSize: 10,
    marginTop: 2,
  },
  totalsPanel: {
    borderTopWidth: 1,
    borderTopColor: '#163056',
    backgroundColor: '#08162d',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  totalLabel: {
    color: '#c5d5ea',
    fontSize: 15,
  },
  totalLabelMuted: {
    color: '#93a4c3',
    fontSize: 14,
  },
  totalLabelAccent: {
    color: '#67e8b2',
    fontSize: 14,
  },
  totalValue: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  totalValueMuted: {
    color: '#9fb2d2',
    fontSize: 14,
    fontWeight: '600',
  },
  totalValueAccent: {
    color: '#67e8b2',
    fontSize: 14,
    fontWeight: '700',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#132645',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  grandTotalLabel: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '900',
  },
  grandTotalValue: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '900',
  },
  paymentLock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    backgroundColor: '#1e2f4e',
  },
  paymentLockActive: {
    backgroundColor: '#19d295',
  },
  paymentLockDisabled: {
    backgroundColor: '#1e2f4e',
    opacity: 0.55,
  },
  paymentLockText: {
    color: '#7f93b2',
    fontSize: 16,
    fontWeight: '700',
  },
  paymentLockTextActive: {
    color: '#032030',
    fontWeight: '800',
  },
  cartActions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#163056',
    backgroundColor: '#091427',
  },
  footerAction: {
    flex: 1,
    minHeight: 54,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#253c62',
    backgroundColor: '#16243d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  footerActionDanger: {
    backgroundColor: '#f3173f',
    borderColor: '#f3173f',
  },
  footerActionText: {
    color: '#eff4ff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  footerActionDangerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  contentColumn: {
    flex: 1,
    backgroundColor: '#071325',
  },
  searchWrap: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#163056',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInputWrap: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0ecaa8',
    backgroundColor: '#0a1530',
    color: '#f8fbff',
    fontSize: 16,
    paddingHorizontal: 20,
    paddingRight: 56,
  },
  searchClearButton: {
    position: 'absolute',
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f4b75',
    backgroundColor: '#173056',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearButtonText: {
    color: '#d8e8ff',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
  },
  searchScannerButton: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f4b75',
    backgroundColor: '#12233f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchScannerIconFrame: {
    width: 28,
    height: 28,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchScannerCorner: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: '#8bc8ff',
  },
  searchScannerCornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 3,
  },
  searchScannerCornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 3,
  },
  searchScannerCornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 3,
  },
  searchScannerCornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 3,
  },
  searchScannerBarsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  searchScannerBar: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: '#dce8fa',
  },
  searchScannerBarNarrow: {
    height: 9,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 98,
    elevation: 30,
    backgroundColor: 'rgba(2, 6, 23, 0.74)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  scannerCard: {
    width: '100%',
    maxWidth: 860,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#2f466d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  scannerTitle: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
  },
  scannerCloseButton: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#35517d',
    backgroundColor: '#142644',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scannerCloseText: {
    color: '#e6f0ff',
    fontSize: 13,
    fontWeight: '700',
  },
  scannerHint: {
    color: '#9fb4d2',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 10,
  },
  scannerCameraWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2f4b75',
    backgroundColor: '#061124',
  },
  scannerFrame: {
    position: 'absolute',
    left: '18%',
    top: '25%',
    width: '64%',
    height: '50%',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#19d295',
    backgroundColor: 'transparent',
  },
  scannerUnavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  scannerUnavailableText: {
    color: '#dbe8fb',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  catalogScroll: {
    flex: 1,
  },
  catalogContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  tilePagerViewport: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  tilePagerPage: {
    width: '100%',
  },
  tilePagerPageAbsolute: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    width: '100%',
    alignSelf: 'stretch',
  },
  categoryTile: {
    borderRadius: 14,
    padding: 18,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#23426f',
  },
  productTile: {
    borderRadius: 14,
    padding: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#4a5f80',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  productTileMain: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  productTileFooter: {
    width: '100%',
    minHeight: 22,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  backTile: {
    borderRadius: 14,
    backgroundColor: '#0d1b33',
    borderWidth: 1,
    borderColor: '#42587f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTileText: {
    color: '#eef3ff',
    fontSize: 18,
    fontWeight: '800',
  },
  tileImage: {
    width: '84%',
  },
  categoryTileLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 18,
    width: '100%',
  },
  productTileLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 17,
    width: '100%',
  },
  productTilePrice: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
    lineHeight: 16,
  },
  stateCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#29436e',
    backgroundColor: '#0b162b',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  stateBody: {
    color: '#9bb0ce',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  catalogFooter: {
    minHeight: 66,
    borderTopWidth: 1,
    borderTopColor: '#163056',
    backgroundColor: '#0b162b',
    paddingHorizontal: 20,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catalogFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  catalogFooterText: {
    color: '#dce8fa',
    fontSize: 15,
    fontWeight: '600',
  },
  homeButton: {
    minWidth: 68,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#223656',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginVertical: 2,
  },
  homeButtonText: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  footerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  zoomButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#223656',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  zoomButtonDisabled: {
    opacity: 0.45,
  },
  zoomButtonText: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
  },
  zoomValue: {
    minWidth: 54,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#223656',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginVertical: 2,
  },
  zoomValueText: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 95,
    elevation: 24,
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingRight: 12,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  userMenuPanel: {
    width: 420,
    flex: 1,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(43, 66, 108, 0.8)',
    backgroundColor: '#071634',
    overflow: 'hidden',
  },
  userMenuHeader: {
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#173057',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userMenuKicker: {
    color: '#66789c',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  userMenuName: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 10,
  },
  userMenuRole: {
    color: '#94a8c7',
    fontSize: 13,
    marginTop: 4,
  },
  userMenuStation: {
    color: '#8fb1da',
    fontSize: 12,
    marginTop: 6,
  },
  userMenuAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a2945',
    borderWidth: 1,
    borderColor: '#2b426c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMenuAvatarText: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  userMenuList: {
    flex: 1,
  },
  userMenuListContent: {
    paddingVertical: 8,
  },
  userMenuItem: {
    minHeight: 78,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userMenuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  userMenuItemIcon: {
    fontSize: 22,
  },
  userMenuItemLabel: {
    color: '#f8fbff',
    fontSize: 17,
    fontWeight: '600',
  },
  userMenuItemLabelDanger: {
    color: '#fecdd3',
  },
  userMenuItemMeta: {
    color: '#94a8c7',
    fontSize: 12,
  },
  userMenuItemMetaDanger: {
    color: '#fda4af',
  },
  userMenuDivider: {
    height: 1,
    backgroundColor: '#173057',
    marginVertical: 6,
  },
  userMenuFooter: {
    borderTopWidth: 1,
    borderTopColor: '#173057',
    paddingHorizontal: 24,
    paddingVertical: 22,
  },
  userMenuFooterKicker: {
    color: '#66789c',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  userMenuFooterValue: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
  },
  userMenuFooterVersion: {
    marginTop: 12,
    color: '#6f86aa',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  actionToastWrap: {
    position: 'absolute',
    top: 96,
    right: 18,
    zIndex: 40,
    maxWidth: 460,
  },
  actionToastCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  actionToastCardError: {
    borderColor: '#ff8ca4',
    backgroundColor: 'rgba(56, 12, 24, 0.96)',
  },
  actionToastCardInfo: {
    borderColor: '#35bda2',
    backgroundColor: 'rgba(9, 50, 58, 0.95)',
  },
  actionToastTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  actionToastTitleError: {
    color: '#ffe5ec',
  },
  actionToastTitleInfo: {
    color: '#bff6ec',
  },
  actionToastMessage: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  successCard: {
    width: '100%',
    maxWidth: 1040,
    maxHeight: '95%',
    minHeight: 420,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2d4266',
    backgroundColor: '#07132a',
    overflow: 'hidden',
  },
  successHeader: {
    paddingHorizontal: 26,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#193253',
  },
  successKicker: {
    color: '#19d295',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  successTitle: {
    color: '#f8fbff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 8,
  },
  successSubtitle: {
    color: '#9ab0d0',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  successBody: {
    flex: 1,
    minHeight: 0,
  },
  successBodyContent: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    paddingBottom: 18,
  },
  successSummary: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#294066',
    backgroundColor: '#0a1a36',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  successLabel: {
    color: '#9ab0d0',
    fontSize: 14,
  },
  successValue: {
    color: '#f7fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  successLabelAccent: {
    color: '#19d295',
    fontSize: 14,
  },
  successValueAccent: {
    color: '#67e8b2',
    fontSize: 14,
    fontWeight: '700',
  },
  successLabelWarn: {
    color: '#f9d27d',
    fontSize: 14,
  },
  successValueWarn: {
    color: '#fce7a0',
    fontSize: 14,
    fontWeight: '700',
  },
  successValueTotal: {
    color: '#19d295',
    fontSize: 24,
    fontWeight: '900',
  },
  successPayments: {
    borderTopWidth: 1,
    borderTopColor: '#1f3556',
    paddingTop: 10,
    gap: 8,
  },
  successNotes: {
    borderTopWidth: 1,
    borderTopColor: '#1f3556',
    paddingTop: 10,
  },
  successNotesLabel: {
    color: '#9ab0d0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  successNotesText: {
    color: '#dbe8fb',
    fontSize: 13,
    lineHeight: 18,
  },
  successActions: {
    borderTopWidth: 1,
    borderTopColor: '#193253',
    paddingHorizontal: 22,
    paddingVertical: 14,
    gap: 10,
  },
  successActionMock: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#35517d',
    backgroundColor: '#142644',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  successActionMockText: {
    color: '#e6f0ff',
    fontSize: 15,
    fontWeight: '700',
  },
  successActionDone: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  successActionDoneText: {
    color: '#032030',
    fontSize: 16,
    fontWeight: '900',
  },
  quantityOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 8,
    backgroundColor: 'rgba(2, 6, 23, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  quantityOverlayContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityOverlayContentKeyboard: {
    paddingTop: 8,
  },
  quantityCard: {
    width: '100%',
    maxWidth: 700,
    maxHeight: '100%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 22,
  },
  discountCard: {
    maxWidth: 760,
    paddingHorizontal: 28,
    paddingTop: 22,
    paddingBottom: 24,
  },
  discountCardCompact: {
    maxWidth: 720,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 18,
  },
  modalCardCompact: {
    maxHeight: '86%',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 14,
  },
  modalCardCompactLarge: {
    maxHeight: '88%',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
  },
  customerCard: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '92%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  customerConfirmCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  customerKicker: {
    color: '#6f85a8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  customerTitle: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  customerCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#3a5278',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerCloseText: {
    color: '#d2dff5',
    fontSize: 20,
    lineHeight: 20,
  },
  customerModeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  customerModeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#314a72',
    backgroundColor: '#0b1a33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerModeButtonActive: {
    borderColor: '#0ecaa8',
    backgroundColor: '#0f2f46',
  },
  customerModeButtonText: {
    color: '#dce8fa',
    fontSize: 14,
    fontWeight: '700',
  },
  customerList: {
    flexGrow: 0,
    maxHeight: 300,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#314a72',
    backgroundColor: '#081224',
    marginBottom: 10,
  },
  customerListContent: {
    paddingVertical: 4,
  },
  customerStateText: {
    color: '#9bb0ce',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
    paddingHorizontal: 14,
  },
  customerRow: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#142746',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  customerRowSelected: {
    backgroundColor: '#0e2a4a',
  },
  customerRowMain: {
    flex: 1,
  },
  customerRowName: {
    color: '#f4f8ff',
    fontSize: 15,
    fontWeight: '700',
  },
  customerRowMeta: {
    color: '#8ea3c6',
    fontSize: 12,
    marginTop: 2,
  },
  customerBadge: {
    color: '#67e8b2',
    fontSize: 11,
    fontWeight: '700',
  },
  customerPagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
    marginBottom: 2,
  },
  customerPagerButton: {
    minWidth: 92,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#314a72',
    backgroundColor: '#12233f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  customerPagerButtonDisabled: {
    opacity: 0.45,
  },
  customerPagerButtonText: {
    color: '#dce8fa',
    fontSize: 12,
    fontWeight: '700',
  },
  customerPagerText: {
    color: '#9bb0ce',
    fontSize: 12,
    fontWeight: '600',
  },
  customerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  customerErrorText: {
    color: '#fda4af',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  customerConfirmName: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  customerConfirmMeta: {
    color: '#9bb0ce',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  quantityTitle: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 14,
  },
  quantityTitleCompact: {
    fontSize: 18,
    marginBottom: 14,
  },
  surchargeCard: {
    width: '100%',
    maxWidth: 780,
    maxHeight: '100%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 20,
  },
  surchargeHint: {
    marginTop: -8,
    marginBottom: 14,
    color: '#94a8c7',
    fontSize: 14,
    textAlign: 'center',
  },
  surchargePresetRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  surchargePresetButton: {
    flex: 1,
    minHeight: 74,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  surchargePresetAmount: {
    marginTop: 4,
    color: '#67e8b2',
    fontSize: 14,
    fontWeight: '700',
  },
  surchargeInputWrap: {
    height: 68,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  surchargeActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  quantityControlsCompact: {
    gap: 10,
  },
  quantityStepper: {
    width: 76,
    height: 76,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityStepperCompact: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  quantityStepperText: {
    color: '#f8fbff',
    fontSize: 34,
    fontWeight: '700',
  },
  quantityStepperTextCompact: {
    fontSize: 30,
  },
  quantityInputWrap: {
    flex: 1,
    height: 82,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    justifyContent: 'center',
  },
  quantityInputWrapCompact: {
    height: 74,
  },
  quantityInput: {
    color: '#f8fbff',
    fontSize: 38,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  quantityInputCompact: {
    fontSize: 28,
  },
  quantityActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 0,
  },
  quantityActionsCompact: {
    marginTop: 0,
    gap: 10,
  },
  discountModeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  discountModeRowSpacious: {
    marginBottom: 12,
  },
  discountModeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountModeButtonActive: {
    backgroundColor: '#1d3358',
    borderColor: '#4d6d9c',
  },
  discountModeButtonText: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  discountInputWrap: {
    height: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  discountInputWrapLarge: {
    marginTop: 4,
    marginBottom: 4,
  },
  discountInputWrapCompact: {
    height: 60,
    borderRadius: 14,
  },
  discountInput: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  discountInputCompact: {
    fontSize: 22,
  },
  quantityCancel: {
    minWidth: 120,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1e2a42',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  quantityCancelText: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '700',
  },
  quantityApply: {
    minWidth: 120,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  quantityApplyText: {
    color: '#031424',
    fontSize: 16,
    fontWeight: '800',
  },
  modalHeader: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 52,
    marginBottom: 10,
  },
  discountHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitleText: {
    width: '100%',
    color: '#f8fbff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalTitleTextCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  discountTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
  },
  modalSubtitleText: {
    color: '#9bb0ce',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: -2,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  modalCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#35527b',
    backgroundColor: '#11243f',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  modalCloseButtonText: {
    color: '#dbe8fb',
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '500',
  },
  modalFooter: {
    marginTop: 12,
    paddingTop: 10,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: '#173057',
    width: '100%',
    minHeight: 52,
    justifyContent: 'center',
  },
  discountFooter: {
    marginTop: 14,
    paddingTop: 12,
  },
});
