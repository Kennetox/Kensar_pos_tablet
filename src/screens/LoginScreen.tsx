import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_VERSION_LABEL } from '../constants/appVersion';
import { useAppSession } from '../contexts/AppSessionContext';
import { ApiError } from '../services/api/client';

const METRIK_LOGO = require('../assets/metriklogo_square.png');

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['Limpiar', '0', 'Borrar'],
];

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const {
    hasStationConfig,
    stationLabel,
    tenantName,
    tabletEmail,
    configureStation,
    clearStationConfig,
    loginWithPin,
    syncStatus,
    syncReason,
    refreshSyncStatus,
  } = useAppSession();
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stationEmail, setStationEmail] = useState(tabletEmail);
  const [stationPassword, setStationPassword] = useState('');
  const [timeLabel, setTimeLabel] = useState('');
  const [refreshingSync, setRefreshingSync] = useState(false);
  const syncMeta = useMemo(() => getSyncMeta(syncStatus), [syncStatus]);
  const canUseApi = syncStatus === 'online' || syncStatus === 'degraded';
  const linkedCompanyName = tenantName.trim();

  useEffect(() => {
    setStationEmail(tabletEmail);
  }, [tabletEmail]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeLabel(
        now.toLocaleTimeString('es-CO', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Bogota',
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const maskedPin = useMemo(() => {
    if (showPin) {
      return pin || 'PIN de acceso';
    }
    return pin ? '•'.repeat(pin.length) : 'PIN de acceso';
  }, [pin, showPin]);

  const gridDots = useMemo(
    () =>
      Array.from({ length: 240 }, (_, index) => (
        <View key={index} style={styles.gridDot} />
      )),
    [],
  );

  const handleDigit = (value: string) => {
    if (value === 'Limpiar') {
      setPin('');
      return;
    }
    if (value === 'Borrar') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    setPin((current) => `${current}${value}`.slice(0, 8));
  };

  const handlePinSubmit = async () => {
    if (submitting) {
      return;
    }
    if (!canUseApi) {
      setError('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await loginWithPin(pin);
      setPin('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('PIN invalido o usuario inactivo.');
        } else if (err.status === 409) {
          setError(
            err.detail ||
              'Esta estacion ya esta vinculada a otro equipo. Solicita soporte.',
          );
        } else {
          setError(err.detail || err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('No pudimos iniciar sesion.');
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfigureStation = async () => {
    if (submitting) {
      return;
    }
    if (!canUseApi) {
      setError('Sin conexión con API. Revalida la conexión para continuar.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await configureStation({
        stationEmail,
        stationPassword,
      });
      setStationPassword('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail || err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('No pudimos validar la estacion.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshSync = async () => {
    setRefreshingSync(true);
    try {
      await refreshSyncStatus();
    } finally {
      setRefreshingSync(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(10, insets.top),
            paddingBottom: Math.max(10, insets.bottom),
          },
        ]}
      >
      <View style={styles.leftGlow} />
      <View style={styles.rightGlow} />
      <View style={styles.gridOverlay}>{gridDots}</View>
      <CornerConstellation />

      <Pressable style={styles.settingsFab} onPress={() => setSettingsOpen(true)}>
        <Text style={styles.settingsFabIcon}>⚙</Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.brandBlock} />
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.leftPanel}>
          <View style={styles.leftTopMeta}>
            <View style={styles.leftKensarBlock}>
              {hasStationConfig && linkedCompanyName ? (
                <Text style={styles.leftCompanyName}>{linkedCompanyName}</Text>
              ) : null}
            </View>
            <View style={styles.leftBrandRow}>
              <Image source={METRIK_LOGO} style={styles.leftMetrikLogo} resizeMode="contain" />
              <View>
                <Text style={styles.leftMetrikBrand}>METRIK POS</Text>
                <Text style={styles.leftStationSubhead}>ESTACION DE CAJA</Text>
              </View>
            </View>
            <View style={styles.leftStatusRow}>
              <Text style={styles.leftTime}>{timeLabel}</Text>
              <Pressable style={styles.leftOnlineWrap} onPress={() => { handleRefreshSync().catch(() => undefined); }}>
                <View style={[styles.footerDot, { backgroundColor: syncMeta.color }]} />
                <Text style={styles.leftOnline}>{syncMeta.label}</Text>
                {refreshingSync ? <ActivityIndicator size="small" color="#d8e4f3" /> : null}
              </Pressable>
            </View>
            {syncReason ? <Text style={styles.leftOnlineDetail}>Detalle: {syncReason}</Text> : null}
          </View>

          <Text style={styles.leftPanelTitle}>
            {hasStationConfig ? 'Inicio rapido en tablet' : 'Vincula esta tablet'}
          </Text>
          <Text style={styles.leftPanelBody}>
            {hasStationConfig
              ? `La caja ${stationLabel || 'activa'} ya quedó vinculada. Ingresa el PIN del vendedor para entrar al POS.`
              : 'Configura una sola vez la estación con su correo y contraseña. Después de eso, cada vendedor entra con su PIN personal.'}
          </Text>
          <Text style={styles.loginVersionText}>{APP_VERSION_LABEL}</Text>
        </View>

        <View style={styles.cardShell}>
          <View style={styles.cardGlow} />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {hasStationConfig ? 'Inicio de sesion' : 'Configuracion de estacion'}
            </Text>
            <Text style={styles.cardSubtitle}>
              {hasStationConfig
                ? `Estacion: ${stationLabel || 'POS Tablet'}`
                : 'Usa el correo y la contraseña definidos para la estacion.'}
            </Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {hasStationConfig ? (
              <>
                <Text style={styles.fieldCaption}>PIN de usuario</Text>
                <View style={styles.pinDisplay}>
                  <Text style={styles.pinValue}>{maskedPin}</Text>
                  <Pressable onPress={() => setShowPin((current) => !current)}>
                    <Text style={styles.pinAction}>{showPin ? 'Ocultar' : 'Ver'}</Text>
                  </Pressable>
                </View>

                <View style={styles.keypad}>
                  {KEYPAD_ROWS.map((row) => (
                    <View key={row.join('-')} style={styles.keypadRow}>
                      {row.map((value) => {
                        const isAction = value === 'Limpiar' || value === 'Borrar';
                        return (
                          <Pressable
                            key={value}
                            style={[styles.keyButton, isAction ? styles.keyButtonAlt : null]}
                            onPress={() => handleDigit(value)}
                          >
                            <Text
                              style={[
                                styles.keyButtonText,
                                isAction ? styles.keyButtonTextAlt : null,
                              ]}
                            >
                              {value}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <Pressable
                  style={[styles.primaryButton, !canUseApi ? styles.primaryButtonDisabled : null]}
                  onPress={handlePinSubmit}
                  disabled={submitting || !canUseApi}
                >
                  <Text style={styles.primaryButtonText}>
                    {submitting ? 'Ingresando...' : 'Entrar al POS'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Field
                  label="Correo de estacion"
                  value={stationEmail}
                  onChangeText={setStationEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="caja1@kensar.com"
                />
                <Field
                  label="Contraseña"
                  value={stationPassword}
                  onChangeText={setStationPassword}
                  autoCapitalize="none"
                  secureTextEntry
                  placeholder="Minimo 6 caracteres"
                />

                <Pressable
                  style={[styles.primaryButton, !canUseApi ? styles.primaryButtonDisabled : null]}
                  onPress={handleConfigureStation}
                  disabled={submitting || !canUseApi}
                >
                  <Text style={styles.primaryButtonText}>
                    {submitting ? 'Validando...' : 'Configurar estacion'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setSettingsOpen(false)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>Opciones de equipo</Text>
            <Pressable
              style={styles.menuButton}
              onPress={() => {
                clearStationConfig();
                setSettingsOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Reconfigurar caja</Text>
            </Pressable>
            <Text style={styles.menuVersionText}>{APP_VERSION_LABEL}</Text>
          </View>
        </Pressable>
      </Modal>
      </View>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  placeholder,
  clearable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  secureTextEntry?: boolean;
  placeholder?: string;
  clearable?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          style={styles.fieldInput}
          placeholder={placeholder}
          placeholderTextColor="#6c778b"
        />
        {clearable && value.length > 0 ? (
          <Pressable style={styles.fieldClearButton} onPress={() => onChangeText('')}>
            <Text style={styles.fieldClearButtonText}>×</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function CornerConstellation() {
  return (
    <View style={styles.constellation}>
      <View style={[styles.constellationDot, { left: 18, top: 16 }]} />
      <View style={[styles.constellationDot, { left: 74, top: 52 }]} />
      <View style={[styles.constellationDot, { left: 136, top: 18 }]} />
      <View style={[styles.constellationDot, { left: 168, top: 74 }]} />
      <View style={[styles.constellationLine, { width: 67, left: 20, top: 24, transform: [{ rotate: '28deg' }] }]} />
      <View style={[styles.constellationLine, { width: 71, left: 80, top: 44, transform: [{ rotate: '-25deg' }] }]} />
      <View style={[styles.constellationLine, { width: 63, left: 132, top: 36, transform: [{ rotate: '62deg' }] }]} />
      <View style={[styles.constellationLine, { width: 106, left: 62, top: 58, transform: [{ rotate: '12deg' }] }]} />
    </View>
  );
}

function getSyncMeta(status: string) {
  if (status === 'online') return { label: 'Conectado', color: '#0A8F5A' };
  if (status === 'degraded') return { label: 'Con advertencia', color: '#F59E0B' };
  if (status === 'offline') return { label: 'Sin conexión API', color: '#DC2626' };
  return { label: 'Validando conexión', color: '#0EA5E9' };
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020817',
  },
  container: {
    flex: 1,
    backgroundColor: '#020817',
    paddingTop: 18,
    paddingBottom: 26,
  },
  leftGlow: {
    position: 'absolute',
    left: -90,
    top: 60,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#0f766e',
    opacity: 0.17,
  },
  rightGlow: {
    position: 'absolute',
    right: -80,
    bottom: 10,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#1d4ed8',
    opacity: 0.14,
  },
  gridOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    paddingHorizontal: 26,
    paddingVertical: 36,
    opacity: 0.22,
  },
  gridDot: {
    width: 18,
    height: 18,
    marginHorizontal: 4,
    marginVertical: 4,
    borderRadius: 9,
    backgroundColor: '#60a5fa',
    opacity: 0.18,
    transform: [{ scale: 0.14 }],
  },
  constellation: {
    position: 'absolute',
    right: 84,
    top: 76,
    width: 190,
    height: 96,
    opacity: 0.52,
  },
  constellationDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38bdf8',
  },
  constellationLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.35)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 116,
    paddingTop: 20,
  },
  brandBlock: {
    minWidth: 280,
    justifyContent: 'flex-start',
  },
  headerSpacer: {
    width: 420,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 68,
    paddingHorizontal: 96,
    paddingTop: 28,
    paddingBottom: 36,
  },
  leftPanel: {
    width: 400,
    gap: 22,
    paddingTop: 22,
  },
  leftTopMeta: {
    gap: 18,
    marginBottom: 18,
  },
  leftKensarBlock: {
    gap: 6,
    marginBottom: 10,
  },
  leftCompanyName: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  leftBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  leftMetrikLogo: {
    width: 54,
    height: 54,
  },
  leftMetrikBrand: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  leftStationSubhead: {
    color: '#cbd5e1',
    fontSize: 13,
    letterSpacing: 4,
    marginTop: 4,
  },
  leftStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  leftTime: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  leftOnlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leftOnline: {
    color: '#d8e4f3',
    fontSize: 15,
    fontWeight: '600',
  },
  leftOnlineDetail: {
    color: '#9cb2d3',
    fontSize: 12,
    marginTop: -8,
  },
  leftPanelTitle: {
    color: '#f8fafc',
    fontSize: 52,
    fontWeight: '800',
    lineHeight: 58,
  },
  leftPanelBody: {
    color: '#b9c9df',
    fontSize: 18,
    lineHeight: 32,
  },
  loginVersionText: {
    marginTop: 10,
    color: '#7f95b6',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  cardShell: {
    width: 600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGlow: {
    position: 'absolute',
    width: 500,
    height: 500,
    borderRadius: 44,
    backgroundColor: '#ffffff',
    opacity: 0.07,
  },
  card: {
    width: '100%',
    borderRadius: 36,
    paddingHorizontal: 34,
    paddingTop: 34,
    paddingBottom: 26,
    backgroundColor: 'rgba(115, 122, 137, 0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  cardSubtitle: {
    color: '#d7dfeb',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 18,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 14,
    textAlign: 'center',
  },
  fieldCaption: {
    color: '#d7dfeb',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginLeft: 2,
  },
  pinDisplay: {
    borderRadius: 18,
    backgroundColor: 'rgba(7, 18, 40, 0.88)',
    borderWidth: 1,
    borderColor: '#d6b85e',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
  },
  pinValue: {
    color: '#f8fafc',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 3.2,
    marginBottom: 10,
  },
  pinAction: {
    color: '#c7d2fe',
    fontSize: 14,
    fontWeight: '700',
  },
  keypad: {
    gap: 12,
    marginBottom: 16,
  },
  keypadRow: {
    flexDirection: 'row',
    gap: 12,
  },
  keyButton: {
    flex: 1,
    minHeight: 74,
    borderRadius: 20,
    backgroundColor: 'rgba(99, 107, 121, 0.74)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyButtonAlt: {
    backgroundColor: 'rgba(89, 97, 112, 0.82)',
  },
  keyButtonText: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  keyButtonTextAlt: {
    fontSize: 17,
  },
  primaryButton: {
    minHeight: 72,
    borderRadius: 20,
    backgroundColor: '#11d39a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#11d39a',
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#05221a',
    fontSize: 17,
    fontWeight: '900',
  },
  fieldWrap: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#dbe5f2',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  fieldInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  fieldInput: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(214, 184, 94, 0.9)',
    backgroundColor: 'rgba(7, 18, 40, 0.88)',
    color: '#f8fafc',
    fontSize: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    paddingRight: 56,
  },
  fieldClearButton: {
    position: 'absolute',
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldClearButtonText: {
    color: '#cbd5e1',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 20,
  },
  footerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  settingsFab: {
    position: 'absolute',
    left: 52,
    top: 32,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(55, 65, 81, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsFabIcon: {
    color: '#e2e8f0',
    fontSize: 24,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.45)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 104,
    paddingLeft: 34,
  },
  menuCard: {
    width: 280,
    borderRadius: 24,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 18,
    gap: 14,
  },
  menuTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  menuButton: {
    borderRadius: 16,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuButtonText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  menuVersionText: {
    marginTop: 6,
    color: '#8ca2c4',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
