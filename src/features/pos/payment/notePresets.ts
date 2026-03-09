export type SaleNotePreset = {
  id: string;
  label: string;
  text: string;
};

export const SALE_NOTE_PRESETS: SaleNotePreset[] = [
  { id: 'warranty-12', label: 'Garantía 1 año', text: 'Garantía de 1 año' },
  { id: 'warranty-6', label: 'Garantía 6 meses', text: 'Garantía de 6 meses' },
  { id: 'warranty-3', label: 'Garantía 3 meses', text: 'Garantía de 3 meses' },
  { id: 'no-warranty', label: 'Sin Garantía', text: 'Sin garantía' },
  { id: 'exchange-7', label: 'Cambio 7 días', text: 'Cambio o devolución dentro de 7 días hábiles' },
];
