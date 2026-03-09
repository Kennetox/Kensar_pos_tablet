import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SALE_NOTE_PRESETS } from './notePresets';
import type { PaymentMethodRecord } from '../../../services/api/paymentMethods';

export type PaymentLineInput = {
  id: number;
  method: string;
  amount: number;
  separatedRealMethod?: string | null;
};

export type PaymentCartItemPreview = {
  id: number;
  name: string;
  quantity: number;
  unitPrice: number;
  lineDiscountValue: number;
  lineTotal: number;
  freeSaleReason?: string;
};

type PaymentPageProps = {
  mode: 'single' | 'multiple';
  saleNumberLabel: string;
  totalToPay: number;
  cart: PaymentCartItemPreview[];
  cartGrossSubtotal: number;
  cartLineDiscountTotal: number;
  cartSubtotal: number;
  cartDiscountValue: number;
  cartDiscountPercent: number;
  surchargeEnabled: boolean;
  surchargeAmount: number;
  surchargeLabel: string;
  saleNotes: string;
  selectedCustomer?: {
    name: string;
    phone?: string | null;
    email?: string | null;
    taxId?: string | null;
  } | null;
  paymentMethods: PaymentMethodRecord[];
  selectedMethod: string;
  separatedPaymentMethod: string | null;
  separatedMethodOptions: PaymentMethodRecord[];
  inputValue: string;
  requiresManualAmount: boolean;
  displayChangeLabel: string;
  displayChange: number;
  multipleLines: PaymentLineInput[];
  selectedLineId: number | null;
  multipleTotalPaid: number;
  multipleDiff: number;
  multipleBadgeLabel: string;
  multipleBadgeAmount: number;
  isSubmitting: boolean;
  confirmDisabled: boolean;
  errorText: string | null;
  onBack: () => void;
  onConfirm: () => void;
  onConfirmBlocked?: () => void;
  onOpenCustomerModal?: () => void;
  onGoMultiple: () => void;
  onGoSingle: () => void;
  onSelectMethod: (slug: string) => void;
  onSelectSeparatedMethod: (slug: string) => void;
  onSelectLineSeparatedMethod: (lineId: number, slug: string) => void;
  onChangeAmountInput: (value: string) => void;
  onChangeNotes: (value: string) => void;
  onClearNotes: () => void;
  onAddNotePreset: (note: string) => void;
  onSelectLine: (lineId: number) => void;
  onDeleteLine: (lineId: number) => void;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function PaymentPage({
  mode,
  saleNumberLabel,
  totalToPay,
  cart,
  cartGrossSubtotal,
  cartLineDiscountTotal,
  cartSubtotal,
  cartDiscountValue,
  cartDiscountPercent,
  surchargeEnabled,
  surchargeAmount,
  surchargeLabel,
  saleNotes,
  selectedCustomer,
  paymentMethods,
  selectedMethod,
  separatedPaymentMethod,
  separatedMethodOptions,
  inputValue,
  requiresManualAmount,
  displayChangeLabel,
  displayChange,
  multipleLines,
  selectedLineId,
  multipleTotalPaid,
  multipleDiff,
  multipleBadgeLabel,
  multipleBadgeAmount,
  isSubmitting,
  confirmDisabled,
  errorText,
  onBack,
  onConfirm,
  onConfirmBlocked,
  onOpenCustomerModal,
  onGoMultiple,
  onGoSingle,
  onSelectMethod,
  onSelectSeparatedMethod,
  onSelectLineSeparatedMethod,
  onChangeAmountInput,
  onChangeNotes,
  onClearNotes,
  onAddNotePreset,
  onSelectLine,
  onDeleteLine,
}: PaymentPageProps) {
  const insets = useSafeAreaInsets();
  const selectedLine = multipleLines.find((line) => line.id === selectedLineId) ?? multipleLines[0] ?? null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(8, insets.top), minHeight: 72 + Math.max(0, insets.top - 8) }]}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Volver al POS</Text>
          </Pressable>
          <View style={styles.headerCustomer}>
            {selectedCustomer?.name?.trim() ? (
              <>
                <Text style={styles.headerCustomerKicker}>Cliente</Text>
                <Text style={styles.headerCustomerName} numberOfLines={1}>
                  {selectedCustomer.name.trim()}
                </Text>
                {(selectedCustomer.phone || selectedCustomer.taxId) ? (
                  <Text style={styles.headerCustomerMeta} numberOfLines={1}>
                    {selectedCustomer.phone?.trim() || selectedCustomer.taxId?.trim() || ''}
                  </Text>
                ) : null}
              </>
            ) : (
              <Pressable style={styles.headerCustomerAddButton} onPress={onOpenCustomerModal}>
                <Text style={styles.headerCustomerAddText}>+ Agregar cliente</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.headerBlock}>
            <Text style={styles.headerKicker}>Venta</Text>
            <Text style={styles.headerValue}>#{saleNumberLabel}</Text>
          </View>
          <View style={styles.headerBlock}>
            <Text style={styles.headerKicker}>Total</Text>
            <Text style={styles.headerTotal}>{formatMoney(totalToPay)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.leftCol}>
          <Text style={styles.sectionTitle}>Artículos</Text>
          <ScrollView
            style={styles.leftList}
            contentContainerStyle={styles.leftListContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {cart.map((item) => (
              <View key={item.id} style={styles.leftItem}>
                <Text style={styles.leftItemName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.leftItemMeta}>
                  {item.quantity} x {formatMoney(item.unitPrice)}
                </Text>
                <Text style={styles.leftItemTotal}>{formatMoney(item.lineTotal)}</Text>
                {item.lineDiscountValue > 0 ? (
                  <Text style={styles.leftItemDiscount}>Descuento -{formatMoney(item.lineDiscountValue)}</Text>
                ) : null}
                {item.freeSaleReason?.trim() ? (
                  <Text style={styles.leftItemReason}>Motivo venta libre: {item.freeSaleReason.trim()}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <View style={styles.leftTotals}>
            {cartLineDiscountTotal > 0 ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Subtotal sin descuentos</Text>
                  <Text style={styles.totalValue}>{formatMoney(cartGrossSubtotal)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabelAccent}>Descuento artículos</Text>
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
            {surchargeEnabled && surchargeAmount > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{surchargeLabel}</Text>
                <Text style={styles.totalValue}>{formatMoney(surchargeAmount)}</Text>
              </View>
            ) : null}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabelBig}>TOTAL</Text>
              <Text style={styles.totalValueBig}>{formatMoney(totalToPay)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.middleCol}>
          <View style={styles.methodsCol}>
            <Text style={styles.sectionTitle}>Tipo de pago</Text>
            <ScrollView style={styles.methodsList} contentContainerStyle={styles.methodsListContent}>
              {paymentMethods.map((method) => {
                const inUse = mode === 'multiple' && multipleLines.some((line) => line.method === method.slug);
                const isSelected = mode === 'single'
                  ? selectedMethod === method.slug
                  : selectedLine?.method === method.slug;
                return (
                  <Pressable
                    key={method.id}
                    style={[
                      styles.methodButton,
                      inUse ? styles.methodButtonUsed : null,
                      isSelected ? styles.methodButtonActive : null,
                      !isSelected && method.color ? { backgroundColor: method.color, borderColor: method.color } : null,
                    ]}
                    onPress={() => onSelectMethod(method.slug)}
                  >
                    <Text style={[styles.methodButtonText, isSelected ? styles.methodButtonTextActive : null]}>
                      {method.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.paymentMain}>
            <ScrollView
              style={styles.paymentMainScroll}
              contentContainerStyle={styles.paymentMainContent}
              showsVerticalScrollIndicator
            >
            <Text style={styles.paymentTitle}>{mode === 'single' ? 'Pago' : 'Pago múltiple'}</Text>
            <Text style={styles.paymentSubtitle}>
              {mode === 'single'
                ? 'Ajusta el monto recibido y agrega notas antes de confirmar.'
                : 'Ajusta cada línea y revisa el total antes de confirmar.'}
            </Text>

            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Total</Text>
                <Text style={styles.cardValue}>{formatMoney(totalToPay)}</Text>
              </View>
              {mode === 'multiple' ? (
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Pagado</Text>
                  <Text style={styles.cardValue}>{formatMoney(multipleTotalPaid)}</Text>
                </View>
              ) : null}
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>
                  {mode === 'multiple' ? multipleBadgeLabel : displayChangeLabel}
                </Text>
                <Text
                  style={[
                    styles.badge,
                    mode === 'multiple' && multipleDiff < 0 ? styles.badgeDanger : styles.badgeOk,
                    mode === 'single' && displayChange < 0 ? styles.badgeDanger : null,
                  ]}
                >
                  {formatMoney(mode === 'multiple' ? multipleBadgeAmount : displayChange)}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>
                {mode === 'single' ? 'Pagado' : 'Monto de la línea seleccionada'}
              </Text>
              <TextInput
                value={inputValue}
                onChangeText={onChangeAmountInput}
                keyboardType="number-pad"
                editable={mode === 'multiple' || requiresManualAmount}
                selectTextOnFocus={mode === 'single' ? requiresManualAmount : true}
                style={[
                  styles.amountInput,
                  mode === 'single' && !requiresManualAmount ? styles.amountInputDisabled : null,
                ]}
                placeholder="0"
                placeholderTextColor="#7282a3"
              />
              {mode === 'single' && selectedMethod === 'separado' ? (
                <View style={styles.separatedWrap}>
                  <Text style={styles.cardLabel}>Método del abono inicial</Text>
                  <View style={styles.optionWrap}>
                    {separatedMethodOptions.map((option) => (
                      <Pressable
                        key={option.id}
                        style={[
                          styles.optionButton,
                          separatedPaymentMethod === option.slug ? styles.optionButtonActive : null,
                        ]}
                        onPress={() => onSelectSeparatedMethod(option.slug)}
                      >
                        <Text style={styles.optionButtonText}>{option.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {mode === 'multiple' && selectedLine?.method === 'separado' ? (
                <View style={styles.separatedWrap}>
                  <Text style={styles.cardLabel}>Método real del abono inicial</Text>
                  <View style={styles.optionWrap}>
                    {separatedMethodOptions.map((option) => (
                      <Pressable
                        key={option.id}
                        style={[
                          styles.optionButton,
                          selectedLine.separatedRealMethod === option.slug ? styles.optionButtonActive : null,
                        ]}
                        onPress={() => onSelectLineSeparatedMethod(selectedLine.id, option.slug)}
                      >
                        <Text style={styles.optionButtonText}>{option.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            {mode === 'multiple' ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Líneas de pago</Text>
                {multipleLines.map((line) => (
                  <Pressable
                    key={line.id}
                    style={[styles.lineRow, line.id === selectedLineId ? styles.lineRowActive : null]}
                    onPress={() => onSelectLine(line.id)}
                  >
                    <View>
                      <Text style={styles.lineMethod}>{paymentMethods.find((method) => method.slug === line.method)?.name ?? line.method}</Text>
                      <Text style={styles.lineHint}>Monto asignado</Text>
                    </View>
                    <View style={styles.lineRight}>
                      <Text style={styles.lineAmount}>{formatMoney(line.amount)}</Text>
                      {multipleLines.length > 1 ? (
                        <Pressable style={styles.lineDelete} onPress={() => onDeleteLine(line.id)}>
                          <Text style={styles.lineDeleteText}>×</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <View style={styles.notesHeader}>
                <Text style={styles.notesTitle}>Notas adicionales</Text>
                <Pressable style={styles.clearButton} onPress={onClearNotes}>
                  <Text style={styles.clearButtonText}>Limpiar</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.notesPresets}>
                {SALE_NOTE_PRESETS.map((preset) => (
                  <Pressable key={preset.id} style={styles.presetButton} onPress={() => onAddNotePreset(preset.text)}>
                    <Text style={styles.presetButtonText}>{preset.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput
                value={saleNotes}
                onChangeText={onChangeNotes}
                multiline
                numberOfLines={4}
                style={styles.notesInput}
                placeholder="Notas de garantía, instrucciones especiales..."
                placeholderTextColor="#7282a3"
              />
            </View>
            </ScrollView>
          </View>
        </View>
      </View>

      {errorText ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorBarText}>{errorText}</Text>
        </View>
      ) : null}

      <View style={[styles.footer, { paddingBottom: Math.max(10, insets.bottom), minHeight: 90 + Math.max(0, insets.bottom - 10) }]}>
        <Pressable style={[styles.footerButton, styles.footerCancel]} onPress={onBack}>
          <Text style={styles.footerCancelText}>Cancelar</Text>
        </Pressable>
        {mode === 'single' ? (
          <Pressable style={[styles.footerButton, styles.footerAlt]} onPress={onGoMultiple}>
            <Text style={styles.footerAltText}>Pagos múltiples</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.footerButton, styles.footerAlt]} onPress={onGoSingle}>
            <Text style={styles.footerAltText}>Volver a pago simple</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.footerButton, styles.footerConfirm, (isSubmitting || confirmDisabled) ? styles.footerDisabled : null]}
          onPress={() => {
            if (isSubmitting) {
              return;
            }
            if (confirmDisabled) {
              onConfirmBlocked?.();
              return;
            }
            onConfirm();
          }}
          disabled={isSubmitting}
        >
          <Text style={styles.footerConfirmText}>
            {isSubmitting ? 'Procesando...' : mode === 'single' ? 'Confirmar pago' : 'Confirmar pago múltiple'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020a1b',
  },
  header: {
    height: 72,
    borderBottomWidth: 1,
    borderBottomColor: '#1c3154',
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#081327',
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 10,
  },
  backButton: {
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#122442',
  },
  backButtonText: {
    color: '#d8e6fb',
    fontSize: 14,
    fontWeight: '700',
  },
  headerCustomer: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCustomerKicker: {
    color: '#6f86ab',
    fontSize: 10,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 2,
    textAlign: 'center',
  },
  headerCustomerName: {
    color: '#e6f0ff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  headerCustomerMeta: {
    color: '#8ea3c6',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  headerCustomerAddButton: {
    height: 42,
    minWidth: 180,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4f7a',
    backgroundColor: '#0f2443',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  headerCustomerAddText: {
    color: '#dbe8fb',
    fontSize: 14,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    gap: 18,
  },
  headerBlock: {
    alignItems: 'flex-end',
  },
  headerKicker: {
    color: '#7a8ead',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  headerValue: {
    color: '#c5d5ee',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTotal: {
    color: '#19d295',
    fontSize: 28,
    fontWeight: '900',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  leftCol: {
    width: 290,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightColor: '#1c3154',
    backgroundColor: '#04122a',
  },
  sectionTitle: {
    color: '#d7e5fb',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c3154',
  },
  leftList: {
    flex: 1,
    minHeight: 0,
  },
  leftListContent: {
    paddingBottom: 10,
  },
  leftItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#102543',
  },
  leftItemName: {
    color: '#f7fbff',
    fontSize: 18,
    fontWeight: '700',
  },
  leftItemMeta: {
    color: '#8ea3c6',
    fontSize: 14,
    marginTop: 4,
  },
  leftItemTotal: {
    color: '#f7fbff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  leftItemDiscount: {
    color: '#19d295',
    fontSize: 13,
    marginTop: 2,
  },
  leftItemReason: {
    color: '#67e8b2',
    fontSize: 12,
    marginTop: 4,
  },
  leftTotals: {
    borderTopWidth: 1,
    borderTopColor: '#1c3154',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    color: '#a9bddd',
    fontSize: 15,
  },
  totalValue: {
    color: '#f7fbff',
    fontSize: 18,
    fontWeight: '700',
  },
  totalLabelAccent: {
    color: '#19d295',
    fontSize: 15,
  },
  totalValueAccent: {
    color: '#19d295',
    fontSize: 18,
    fontWeight: '700',
  },
  totalLabelBig: {
    color: '#f7fbff',
    fontSize: 22,
    fontWeight: '900',
  },
  totalValueBig: {
    color: '#19d295',
    fontSize: 40,
    fontWeight: '900',
  },
  middleCol: {
    flex: 1,
    flexDirection: 'row',
  },
  methodsCol: {
    width: 206,
    borderRightWidth: 1,
    borderRightColor: '#1c3154',
    backgroundColor: '#06152d',
  },
  methodsList: {
    flex: 1,
  },
  methodsListContent: {
    padding: 8,
    gap: 6,
  },
  methodButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b446c',
    backgroundColor: '#132747',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  methodButtonUsed: {
    borderColor: '#1aa672',
  },
  methodButtonActive: {
    backgroundColor: '#19d295',
    borderColor: '#19d295',
  },
  methodButtonText: {
    color: '#e5f0ff',
    fontSize: 14,
    fontWeight: '700',
  },
  methodButtonTextActive: {
    color: '#052035',
  },
  paymentMain: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paymentMainScroll: {
    flex: 1,
  },
  paymentMainContent: {
    paddingBottom: 12,
  },
  paymentTitle: {
    color: '#f7fbff',
    fontSize: 28,
    fontWeight: '800',
  },
  paymentSubtitle: {
    color: '#94a8c7',
    fontSize: 14,
    marginBottom: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#294066',
    backgroundColor: '#08182f',
    padding: 12,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardLabel: {
    color: '#d0def4',
    fontSize: 16,
  },
  cardValue: {
    color: '#f7fbff',
    fontSize: 24,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 20,
    fontWeight: '700',
  },
  badgeOk: {
    color: '#7bf4cf',
    backgroundColor: '#0f3f35',
  },
  badgeDanger: {
    color: '#ffb4b4',
    backgroundColor: '#4f2230',
  },
  amountInput: {
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1dc8a0',
    backgroundColor: '#0a1c38',
    color: '#f7fbff',
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
  },
  amountInputDisabled: {
    opacity: 0.45,
    borderColor: '#33496d',
  },
  separatedWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a2f4f',
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#36507a',
    backgroundColor: '#10213d',
  },
  optionButtonActive: {
    borderColor: '#19d295',
    backgroundColor: '#0f4f3f',
  },
  optionButtonText: {
    color: '#d9e7fb',
    fontSize: 14,
    fontWeight: '600',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a2f4f',
    backgroundColor: '#0a1932',
    marginBottom: 6,
  },
  lineRowActive: {
    backgroundColor: '#15315a',
    borderColor: '#4d6d9c',
  },
  lineMethod: {
    color: '#f7fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  lineHint: {
    color: '#8ea3c6',
    fontSize: 12,
  },
  lineRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineAmount: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  lineDelete: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2a3d61',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineDeleteText: {
    color: '#f7fbff',
    fontSize: 14,
    fontWeight: '900',
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notesTitle: {
    color: '#d7e5fb',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  clearButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#36507a',
    backgroundColor: '#0a1932',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearButtonText: {
    color: '#d7e5fb',
    fontSize: 13,
    fontWeight: '700',
  },
  notesPresets: {
    paddingVertical: 10,
    gap: 8,
  },
  presetButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#36507a',
    backgroundColor: '#10213d',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetButtonText: {
    color: '#d7e5fb',
    fontSize: 13,
    fontWeight: '600',
  },
  notesInput: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#36507a',
    backgroundColor: '#020d24',
    color: '#f7fbff',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  errorBar: {
    borderTopWidth: 1,
    borderTopColor: '#6d2336',
    borderBottomWidth: 1,
    borderBottomColor: '#6d2336',
    backgroundColor: '#481a2a',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  errorBarText: {
    color: '#ffc2d0',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    height: 90,
    borderTopWidth: 1,
    borderTopColor: '#1c3154',
    backgroundColor: '#081327',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 10,
  },
  footerButton: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerCancel: {
    backgroundColor: '#e11d48',
  },
  footerCancelText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  footerAlt: {
    backgroundColor: '#223453',
  },
  footerAltText: {
    color: '#d7e5fb',
    fontSize: 22,
    fontWeight: '700',
  },
  footerConfirm: {
    backgroundColor: '#19d295',
  },
  footerConfirmText: {
    color: '#032030',
    fontSize: 22,
    fontWeight: '800',
  },
  footerDisabled: {
    opacity: 0.55,
  },
});
