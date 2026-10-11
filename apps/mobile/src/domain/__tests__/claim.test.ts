import { defaultProof, mileageAmount, perDiemTotal, summarizeClaim, tripDays } from '../claim';
import type { Expense, Trip } from '../models';
import { BUILTIN_PRESETS, buildReport, type ReportLabels } from '../report';

const trip: Trip = {
  id: 't', title: 'Busan', startDate: '2026-10-01', endDate: '2026-10-03', baseCurrency: 'KRW',
  budget: { kind: 'none' }, perDiem: { amount: '30000' }, createdAt: '',
};
const expense = (id: string, over: Partial<Expense>): Expense => ({
  id, tripId: 't', localDate: '2026-10-01', merchantName: id, category: 'meals', paymentMethod: 'personal_card',
  currency: 'KRW', total: '11000', fxRate: '1', baseCurrency: 'KRW', totalBase: '11000', receiptId: null, memo: '',
  createdAt: id, updatedAt: id, ...over,
});

describe('per diem', () => {
  it('pays for every trip day unless overridden', () => {
    expect(tripDays(trip)).toBe(3);
    expect(perDiemTotal(trip)).toBe(90000n);
    expect(perDiemTotal({ ...trip, perDiem: { amount: '30000', days: 2 } })).toBe(60000n);
    expect(perDiemTotal({ ...trip, perDiem: undefined })).toBe(0n);
  });
});

describe('summarizeClaim', () => {
  const expenses = [
    expense('a', { vat: '1000', proof: 'card_slip' }),
    expense('b', { paymentMethod: 'corporate_card', total: '22000', totalBase: '22000', vat: '2000', proof: 'tax_invoice' }),
    expense('c', { currency: 'JPY', total: '1100', fxRate: '9', totalBase: '9900', vat: '100', proof: 'foreign_receipt' }),
    expense('d', { missingReceipt: { reason: 'lost', signer: 'Harry', signedAt: '2026-10-02T00:00:00Z' } }),
    expense('other-trip', { tripId: 'x' }),
  ];

  it('splits company-paid from personal and adds the allowance', () => {
    const s = summarizeClaim(trip, expenses);
    expect(s.spent).toBe(53900n);
    expect(s.companyPaid).toBe(22000n);
    expect(s.personal).toBe(31900n);
    expect(s.claim).toBe(31900n + 90000n);
    expect(s.missingReceipts).toBe(1);
  });

  it('totals deductible and foreign VAT in the base currency', () => {
    const s = summarizeClaim(trip, expenses);
    expect(s.vatDeductible).toBe(3000n);
    expect(s.vatForeign).toBe(900n);
  });

  it('puts the claim lines and lost-receipt statements in the report', () => {
    const labels: ReportLabels = {
      column: (c) => c, category: (c) => c, payment: (p) => p, tagColumn: 'no', receiptNo: (tag) => `att ${tag}`, none: '-', noReceipt: 'noR', mileage: 'car',
      missingReceipt: 'lost', proof: (p) => p,
      claim: {
        spent: 'spent', companyPaid: 'company', personal: 'personal', perDiem: (d, p) => `perDiem ${d} x ${p}`,
        claim: 'claim', vatDeductible: 'vatD', vatForeign: 'vatF',
      },
    };
    const r = buildReport(trip, expenses.filter((e) => e.tripId === 't'), { ...BUILTIN_PRESETS[1]!, columns: ['merchant', 'receipt', 'vat', 'proof'] }, labels);
    expect(r.claim.map((l) => l.label)).toEqual(['spent', 'company', 'personal', 'perDiem 3 x KRW 30,000', 'claim', 'vatD', 'vatF']);
    expect(r.claim.find((l) => l.label === 'claim')).toMatchObject({ number: 121900, strong: true });
    expect(r.affidavits).toEqual([{ tag: '#04', date: '2026-10-01', merchant: 'd', amount: 'KRW 11,000', reason: 'lost', signer: 'Harry', signedAt: '2026-10-02T00:00:00Z' }]);
    const row = r.sections.flatMap((s) => s.rows).find((cells) => cells[1]!.text === 'd')!;
    expect(row[2]!.text).toBe('lost');
  });
});

describe('mileage and proof', () => {
  it('multiplies km by the rate in the base currency', () => {
    expect(mileageAmount('123.5', '300', 'KRW')).toBe(37050n);
    expect(mileageAmount('0', '300', 'KRW')).toBeNull();
  });

  it('guesses the proof type from currency and payment', () => {
    expect(defaultProof('JPY', 'cash')).toBe('foreign_receipt');
    expect(defaultProof('KRW', 'corporate_card')).toBe('card_slip');
    expect(defaultProof('KRW', 'cash')).toBe('simple_receipt');
  });
});
