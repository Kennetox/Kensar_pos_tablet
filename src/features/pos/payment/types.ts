export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type PaymentMode = 'single' | 'multiple';

export type PaymentLine = {
  id: number;
  method: PaymentMethod;
  amount: number;
};

export type PaymentSuccessSummary = {
  saleNumber: number;
  documentNumber: string;
  total: number;
  paidAmount: number;
  changeAmount: number;
  payments: { method: PaymentMethod; amount: number }[];
};

export const PAYMENT_METHOD_OPTIONS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'card', label: 'Tarjeta' },
  { id: 'transfer', label: 'Transferencia' },
];

export function paymentMethodLabel(method: PaymentMethod) {
  return PAYMENT_METHOD_OPTIONS.find((entry) => entry.id === method)?.label ?? method;
}
