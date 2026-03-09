import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  type PaymentLine,
  type PaymentMethod,
  type PaymentMode,
  type PaymentSuccessSummary,
} from './types';

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

type PaymentFlowModalProps = {
  paymentScreenOpen: boolean;
  paymentSuccess: PaymentSuccessSummary | null;
  saleNumberLabel: string;
  cartTotal: number;
  paymentMode: PaymentMode;
  paymentMethod: PaymentMethod;
  paymentValue: string;
  paymentLineInput: string;
  paymentLines: PaymentLine[];
  selectedPaymentLineId: number | null;
  paymentSinglePaid: number;
  paymentSingleChange: number;
  paymentMultipleTotal: number;
  paymentMultipleRemaining: number;
  paymentMultipleChange: number;
  paymentSubmitting: boolean;
  paymentError: string | null;
  onSetPaymentMode: (mode: PaymentMode) => void;
  onSetPaymentMethod: (method: PaymentMethod) => void;
  onSetPaymentValue: (value: string) => void;
  onAddPaymentLine: (method: PaymentMethod) => void;
  onSelectPaymentLine: (lineId: number) => void;
  onDeletePaymentLine: (lineId: number) => void;
  onPaymentLineAmountChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onCloseSuccess: () => void;
  onNewSale: () => void;
};

export function PaymentFlowModal({
  paymentScreenOpen,
  paymentSuccess,
  saleNumberLabel,
  cartTotal,
  paymentMode,
  paymentMethod,
  paymentValue,
  paymentLineInput,
  paymentLines,
  selectedPaymentLineId,
  paymentSinglePaid,
  paymentSingleChange,
  paymentMultipleTotal,
  paymentMultipleRemaining,
  paymentMultipleChange,
  paymentSubmitting,
  paymentError,
  onSetPaymentMode,
  onSetPaymentMethod,
  onSetPaymentValue,
  onAddPaymentLine,
  onSelectPaymentLine,
  onDeletePaymentLine,
  onPaymentLineAmountChange,
  onCancel,
  onConfirm,
  onCloseSuccess,
  onNewSale,
}: PaymentFlowModalProps) {
  return (
    <>
      {paymentScreenOpen ? (
        <View style={styles.overlay}>
          <View style={styles.paymentCard}>
            <Text style={styles.title}>Pago de venta</Text>
            <Text style={styles.saleLabel}>Venta No.{saleNumberLabel}</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatMoney(cartTotal)}</Text>
            </View>
            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeButton, paymentMode === 'single' ? styles.modeButtonActive : null]}
                onPress={() => onSetPaymentMode('single')}
              >
                <Text style={styles.modeButtonText}>Pago unico</Text>
              </Pressable>
              <Pressable
                style={[styles.modeButton, paymentMode === 'multiple' ? styles.modeButtonActive : null]}
                onPress={() => onSetPaymentMode('multiple')}
              >
                <Text style={styles.modeButtonText}>Pago multiple</Text>
              </Pressable>
            </View>

            {paymentMode === 'single' ? (
              <>
                <View style={styles.methodsRow}>
                  {PAYMENT_METHOD_OPTIONS.map((entry) => (
                    <Pressable
                      key={entry.id}
                      style={[styles.methodButton, paymentMethod === entry.id ? styles.methodButtonActive : null]}
                      onPress={() => onSetPaymentMethod(entry.id)}
                    >
                      <Text style={styles.methodButtonText}>{entry.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={paymentValue}
                    onChangeText={(value) => onSetPaymentValue(value.replace(/[^\d]/g, ''))}
                    keyboardType="number-pad"
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor="#7282a3"
                    editable={paymentMethod === 'cash'}
                  />
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Recibido</Text>
                  <Text style={styles.summaryValue}>{formatMoney(paymentSinglePaid)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Cambio</Text>
                  <Text style={styles.summaryValue}>{formatMoney(paymentSingleChange)}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.methodsRow}>
                  {PAYMENT_METHOD_OPTIONS.map((entry) => (
                    <Pressable key={entry.id} style={styles.methodButton} onPress={() => onAddPaymentLine(entry.id)}>
                      <Text style={styles.methodButtonText}>+ {entry.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <ScrollView style={styles.linesList} contentContainerStyle={styles.linesContent}>
                  {paymentLines.map((line) => {
                    const isSelected = line.id === selectedPaymentLineId;
                    return (
                      <Pressable
                        key={line.id}
                        style={[styles.lineRow, isSelected ? styles.lineRowSelected : null]}
                        onPress={() => onSelectPaymentLine(line.id)}
                      >
                        <View style={styles.lineMain}>
                          <Text style={styles.lineMethod}>{paymentMethodLabel(line.method)}</Text>
                          <Text style={styles.lineAmount}>{formatMoney(line.amount)}</Text>
                        </View>
                        {paymentLines.length > 1 ? (
                          <Pressable style={styles.lineDelete} onPress={() => onDeletePaymentLine(line.id)}>
                            <Text style={styles.lineDeleteText}>×</Text>
                          </Pressable>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={paymentLineInput}
                    onChangeText={onPaymentLineAmountChange}
                    keyboardType="number-pad"
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor="#7282a3"
                  />
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Pagado</Text>
                  <Text style={styles.summaryValue}>{formatMoney(paymentMultipleTotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Restante</Text>
                  <Text style={styles.summaryValue}>{formatMoney(paymentMultipleRemaining)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Cambio</Text>
                  <Text style={styles.summaryValue}>{formatMoney(paymentMultipleChange)}</Text>
                </View>
              </>
            )}
            {paymentError ? <Text style={styles.errorText}>{paymentError}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={onCancel} disabled={paymentSubmitting}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.applyButton, paymentSubmitting ? styles.disabled : null]}
                onPress={onConfirm}
                disabled={paymentSubmitting}
              >
                <Text style={styles.applyText}>{paymentSubmitting ? 'Procesando...' : 'Confirmar pago'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {paymentSuccess ? (
        <View style={styles.overlay}>
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Venta registrada</Text>
            <Text style={styles.successSubhead}>Ticket #{paymentSuccess.saleNumber}</Text>
            <Text style={styles.successDoc}>{paymentSuccess.documentNumber}</Text>

            <View style={styles.successTotals}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryValue}>{formatMoney(paymentSuccess.total)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Pagado</Text>
                <Text style={styles.summaryValue}>{formatMoney(paymentSuccess.paidAmount)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Cambio</Text>
                <Text style={styles.summaryValue}>{formatMoney(paymentSuccess.changeAmount)}</Text>
              </View>
            </View>

            <View style={styles.successPayments}>
              {paymentSuccess.payments.map((line, index) => (
                <View key={`${line.method}-${index}`} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{paymentMethodLabel(line.method)}</Text>
                  <Text style={styles.summaryValue}>{formatMoney(line.amount)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={onCloseSuccess}>
                <Text style={styles.cancelText}>Cerrar</Text>
              </Pressable>
              <Pressable style={styles.applyButton} onPress={onNewSale}>
                <Text style={styles.applyText}>Nueva venta</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  paymentCard: {
    width: '100%',
    maxWidth: 620,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 28,
    paddingVertical: 26,
  },
  title: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 22,
  },
  saleLabel: {
    color: '#94a8c7',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 14,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  totalLabel: {
    color: '#dce8fa',
    fontSize: 16,
    fontWeight: '600',
  },
  totalValue: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '900',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  modeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#1d3358',
    borderColor: '#4d6d9c',
  },
  modeButtonText: {
    color: '#f8fbff',
    fontSize: 13,
    fontWeight: '700',
  },
  methodsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  methodButton: {
    minWidth: 140,
    flexGrow: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodButtonActive: {
    backgroundColor: '#1d3358',
    borderColor: '#4d6d9c',
  },
  methodButtonText: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  linesList: {
    maxHeight: 170,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    marginBottom: 12,
  },
  linesContent: {
    paddingVertical: 6,
  },
  lineRow: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a2f4f',
    marginHorizontal: 8,
    marginVertical: 4,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0a1932',
  },
  lineRowSelected: {
    borderColor: '#4d6d9c',
    backgroundColor: '#15315a',
  },
  lineMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    gap: 8,
  },
  lineMethod: {
    color: '#e6eefb',
    fontSize: 13,
    fontWeight: '700',
  },
  lineAmount: {
    color: '#f8fbff',
    fontSize: 13,
    fontWeight: '800',
  },
  lineDelete: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2a3d61',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  lineDeleteText: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  inputWrap: {
    height: 74,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#081224',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  input: {
    color: '#f8fbff',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  summaryLabel: {
    color: '#c4d3e8',
    fontSize: 15,
  },
  summaryValue: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: '#fda4af',
    fontSize: 13,
    marginTop: 12,
  },
  successCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#33496d',
    backgroundColor: '#0b162b',
    paddingHorizontal: 24,
    paddingVertical: 22,
  },
  successTitle: {
    color: '#f8fbff',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  successSubhead: {
    color: '#9ff7d9',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 8,
  },
  successDoc: {
    color: '#9bb0ce',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  successTotals: {
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b355d',
  },
  successPayments: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1b355d',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 22,
  },
  cancelButton: {
    minWidth: 132,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1e2a42',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelText: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '700',
  },
  applyButton: {
    minWidth: 132,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#19d295',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  applyText: {
    color: '#031424',
    fontSize: 16,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.5,
  },
});
