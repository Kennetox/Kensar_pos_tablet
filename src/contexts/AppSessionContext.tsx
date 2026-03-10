import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { logoutSession, posStationLogin, tabletLogin } from '../services/api/auth';
import { ApiError, createApiClient } from '../services/api/client';

type AuthUser = {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
};

export type SyncStatus = 'checking' | 'online' | 'degraded' | 'offline';

type AppSessionValue = {
  isHydrated: boolean;
  isAuthenticated: boolean;
  hasStationConfig: boolean;
  apiBase: string;
  stationId: string;
  stationLabel: string;
  tenantName: string;
  parentStationId: string;
  parentStationLabel: string;
  tabletEmail: string;
  token: string | null;
  user: AuthUser | null;
  syncStatus: SyncStatus;
  syncReason: string | null;
  lastSyncAt: number | null;
  lastSyncCheckAt: number | null;
  refreshSyncStatus: () => Promise<void>;
  deviceId: string;
  deviceLabel: string;
  setApiBase: (value: string) => void;
  configureStation: (payload: {
    stationEmail: string;
    stationPassword: string;
  }) => Promise<void>;
  clearStationConfig: () => void;
  loginWithPin: (pin: string) => Promise<void>;
  logout: () => void;
  expireSession: () => void;
};

type PersistedSession = {
  apiBase?: string;
  stationId?: string;
  stationLabel?: string;
  tenantName?: string;
  parentStationId?: string;
  parentStationLabel?: string;
  tabletEmail?: string;
  token?: string | null;
  tokenIssuedAt?: number | null;
  user?: AuthUser | null;
  deviceId?: string;
  deviceLabel?: string;
};

const DEFAULT_API_BASE_PROD = 'https://api.metrikpos.com';
const DEFAULT_API_BASE_DEV = 'http://10.0.2.2:8000';
const STORAGE_KEY = '@kensar_pos_tablet/session_v1';
const APP_BACKGROUND_KEY = '@kensar_pos_tablet/app_background_v1';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const AppSessionContext = createContext<AppSessionValue | null>(null);

function buildDefaultDeviceLabel() {
  const platform = Platform.OS === 'android' ? 'Android tablet' : 'Tablet';
  return `${platform} POS`;
}

function generateDeviceId() {
  return `tablet-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildStationScopedDeviceId(stationEmail: string) {
  const normalized = stationEmail
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = normalized || 'station';
  return `tablet-${suffix}`;
}

function getDefaultApiBase() {
  return __DEV__ ? DEFAULT_API_BASE_DEV : DEFAULT_API_BASE_PROD;
}

function resolveApiBaseForRuntime(candidate?: string | null) {
  // Release builds must always target the production API.
  if (!__DEV__) {
    return DEFAULT_API_BASE_PROD;
  }
  return candidate?.trim() || getDefaultApiBase();
}

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [stationId, setStationId] = useState('');
  const [stationLabel, setStationLabel] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [parentStationId, setParentStationId] = useState('');
  const [parentStationLabel, setParentStationLabel] = useState('');
  const [tabletEmail, setTabletEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [tokenIssuedAt, setTokenIssuedAt] = useState<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking');
  const [syncReason, setSyncReason] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncCheckAt, setLastSyncCheckAt] = useState<number | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(buildDefaultDeviceLabel());

  const clearSession = useCallback(() => {
    setToken(null);
    setTokenIssuedAt(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [raw, backgroundState] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(APP_BACKGROUND_KEY),
        ]);
        if (!active) {
          return;
        }

        const persisted = raw ? (JSON.parse(raw) as PersistedSession) : null;
        setApiBase(resolveApiBaseForRuntime(persisted?.apiBase));
        setStationId(persisted?.stationId || '');
        setStationLabel(persisted?.stationLabel || '');
        setTenantName(persisted?.tenantName || '');
        setParentStationId(persisted?.parentStationId || '');
        setParentStationLabel(persisted?.parentStationLabel || '');
        setTabletEmail(persisted?.tabletEmail || '');
        const persistedToken = persisted?.token ?? null;
        const persistedTokenIssuedAt = persisted?.tokenIssuedAt ?? null;
        const isPersistedSessionExpired =
          Boolean(persistedToken) &&
          (!persistedTokenIssuedAt || Date.now() - persistedTokenIssuedAt >= SESSION_MAX_AGE_MS);
        const shouldResetByColdStart = backgroundState === '1';
        const shouldClearSession = isPersistedSessionExpired || shouldResetByColdStart;
        setToken(shouldClearSession ? null : persistedToken);
        setTokenIssuedAt(shouldClearSession ? null : persistedTokenIssuedAt);
        setUser(shouldClearSession ? null : (persisted?.user ?? null));
        setDeviceId(persisted?.deviceId || generateDeviceId());
        setDeviceLabel(persisted?.deviceLabel || buildDefaultDeviceLabel());
      } catch {
        setApiBase(resolveApiBaseForRuntime());
        setDeviceId(generateDeviceId());
        setDeviceLabel(buildDefaultDeviceLabel());
      } finally {
        if (active) {
          setIsHydrated(true);
          AsyncStorage.setItem(APP_BACKGROUND_KEY, '0').catch(() => undefined);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !deviceId) {
      return;
    }

    const payload: PersistedSession = {
      apiBase,
      stationId,
      stationLabel,
      tenantName,
      parentStationId,
      parentStationLabel,
      tabletEmail,
      token,
      tokenIssuedAt,
      user,
      deviceId,
      deviceLabel,
    };

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
  }, [
    apiBase,
    deviceId,
    deviceLabel,
    isHydrated,
    stationId,
    stationLabel,
    tenantName,
    parentStationId,
    parentStationLabel,
    tabletEmail,
    token,
    tokenIssuedAt,
    user,
  ]);

  const apiClient = useMemo(
    () =>
      createApiClient({
        getBaseUrl: () => apiBase,
        getToken: () => token,
        onUnauthorized: clearSession,
      }),
    [apiBase, clearSession, token],
  );

  const configureStation = useCallback(
    async ({
      stationEmail,
      stationPassword,
    }: {
      stationEmail: string;
      stationPassword: string;
    }) => {
      const email = stationEmail.trim().toLowerCase();
      const password = stationPassword.trim();

      if (!email || !password) {
        throw new ApiError('Ingresa correo y contraseña de estación.', 400);
      }

      const stationScopedDeviceId = buildStationScopedDeviceId(email);

      const response = await posStationLogin(apiClient, {
        station_email: email,
        station_password: password,
        device_id: stationScopedDeviceId,
        device_label: deviceLabel,
      });

      setDeviceId(stationScopedDeviceId);
      setStationId(response.station_id);
      setStationLabel(response.station_label);
      setTenantName(response.tenant_name?.trim() ?? '');
      setParentStationId(response.parent_station_id?.trim() ?? '');
      setParentStationLabel(response.parent_station_label?.trim() ?? '');
      setTabletEmail(response.station_email);
      setToken(null);
      setTokenIssuedAt(null);
      setUser(null);
    },
    [apiClient, deviceLabel],
  );

  const clearStationConfig = useCallback(() => {
    setStationId('');
    setStationLabel('');
    setTenantName('');
    setParentStationId('');
    setParentStationLabel('');
    setTabletEmail('');
    setToken(null);
    setTokenIssuedAt(null);
    setUser(null);
  }, []);

  const loginWithPin = useCallback(
    async (pin: string) => {
      if (!stationId.trim()) {
        throw new ApiError('Configura una estación válida.', 400);
      }
      if (!pin.trim()) {
        throw new ApiError('Debes ingresar tu PIN.', 400);
      }

      const payload = await tabletLogin(apiClient, {
        station_id: stationId.trim(),
        pin: pin.trim(),
        device_id: deviceId,
        device_label: deviceLabel,
      });

      const authToken = payload.access_token ?? payload.token;
      if (!authToken) {
        throw new ApiError('La API no devolvió token de autenticación.', 500);
      }

      setToken(authToken);
      setTokenIssuedAt(Date.now());
      setUser(
        payload.user ?? {
          id: 0,
          name: 'Usuario POS',
        },
      );
      const tenantNameFromLogin = payload.tenant?.name?.trim();
      if (tenantNameFromLogin) {
        setTenantName(tenantNameFromLogin);
      }
    },
    [apiClient, deviceId, deviceLabel, stationId],
  );

  const logout = useCallback(() => {
    const activeToken = token;
    if (!activeToken) {
      clearSession();
      return;
    }
    logoutSession(apiClient)
      .catch(() => undefined)
      .finally(() => {
        clearSession();
      });
  }, [apiClient, clearSession, token]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        AsyncStorage.setItem(APP_BACKGROUND_KEY, '0').catch(() => undefined);
      } else if (state === 'background') {
        AsyncStorage.setItem(APP_BACKGROUND_KEY, '1').catch(() => undefined);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!token || !tokenIssuedAt) {
      return;
    }
    if (Date.now() - tokenIssuedAt >= SESSION_MAX_AGE_MS) {
      clearSession();
    }
  }, [clearSession, token, tokenIssuedAt]);

  const refreshSyncStatus = useCallback(async () => {
    if (!token) {
      setSyncStatus('checking');
      setSyncReason(null);
      try {
        const base = apiBase.replace(/\/$/, '');
        const res = await fetch(`${base}/auth/session-status`, { method: 'GET' });
        const now = Date.now();
        setLastSyncCheckAt(now);
        if (res.status === 401 || res.status === 403 || res.ok) {
          setSyncStatus('online');
          setSyncReason(null);
          setLastSyncAt(now);
          return;
        }
        setSyncStatus('degraded');
        setSyncReason(`api_status_${res.status}`);
      } catch (err) {
        setLastSyncCheckAt(Date.now());
        setSyncStatus('offline');
        setSyncReason(err instanceof Error ? err.message : 'network_error');
      }
      return;
    }

    try {
      const response = await apiClient.get<{ status?: string; reason?: string }>('/auth/session-status');
      const remoteStatus = (response?.status || '').toLowerCase();
      const remoteReason = response?.reason || null;
      const now = Date.now();
      setLastSyncCheckAt(now);

      if (remoteStatus === 'active') {
        setSyncStatus('online');
        setSyncReason(null);
        setLastSyncAt(now);
        return;
      }

      setSyncStatus('degraded');
      setSyncReason(remoteReason || remoteStatus || 'unknown');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        const now = Date.now();
        setLastSyncCheckAt(now);
        setSyncStatus('online');
        setSyncReason('session_expired');
        return;
      }
      setLastSyncCheckAt(Date.now());
      setSyncStatus('offline');
      setSyncReason(err instanceof Error ? err.message : 'network_error');
    }
  }, [apiBase, apiClient, clearSession, token]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runCheck = async () => {
      if (!active) {
        return;
      }
      await refreshSyncStatus();
    };

    runCheck();
    intervalId = setInterval(runCheck, 30000);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runCheck();
      }
    });

    return () => {
      active = false;
      subscription.remove();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isHydrated, refreshSyncStatus, token]);

  const value = useMemo<AppSessionValue>(
    () => ({
      isHydrated,
      isAuthenticated: Boolean(token),
      hasStationConfig: Boolean(stationId.trim()),
      apiBase,
      stationId,
      stationLabel,
      tenantName,
      parentStationId,
      parentStationLabel,
      tabletEmail,
      token,
      user,
      syncStatus,
      syncReason,
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
      deviceId,
      deviceLabel,
      setApiBase,
      configureStation,
      clearStationConfig,
      loginWithPin,
      logout,
      expireSession: clearSession,
    }),
    [
      apiBase,
      clearStationConfig,
      configureStation,
      deviceId,
      deviceLabel,
      isHydrated,
      loginWithPin,
      logout,
      clearSession,
      stationId,
      stationLabel,
      tenantName,
      parentStationId,
      parentStationLabel,
      tabletEmail,
      token,
      user,
      syncStatus,
      syncReason,
      lastSyncAt,
      lastSyncCheckAt,
      refreshSyncStatus,
    ],
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const value = useContext(AppSessionContext);
  if (!value) {
    throw new Error('useAppSession must be used within AppSessionProvider');
  }
  return value;
}
