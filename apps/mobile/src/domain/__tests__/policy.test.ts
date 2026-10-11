import { toCurrencyCode } from '../money';
import { evaluatePolicies, type ExpenseForPolicy, type PolicyRule, PolicyRuleError, worstAction } from '../policy';

const KRW = toCurrencyCode('KRW');

const expense = (overrides: Partial<ExpenseForPolicy> & Pick<ExpenseForPolicy, 'id'>): ExpenseForPolicy => ({
  localDate: '2026-10-07', // Wednesday
  spentAt: '2026-10-07T12:00:00Z',
  category: 'meals',
  amountInPolicyCurrency: 10000n,
  merchantName: 'Cafe',
  merchantCountry: 'JP',
  lineItems: [],
  hasReceipt: true,
  ...overrides,
});

const rule = (overrides: Partial<PolicyRule> & Pick<PolicyRule, 'ruleType' | 'params'>): PolicyRule => ({
  id: overrides.ruleType,
  category: null,
  region: null,
  action: 'warn',
  message: 'violation',
  ...overrides,
});

describe('evaluatePolicies', () => {
  it('daily_cap flags the expense that crosses the cap and later ones that day', () => {
    const flags = evaluatePolicies(
      [
        expense({ id: 'lunch', spentAt: '2026-10-07T12:00:00Z', amountInPolicyCurrency: 50000n }),
        expense({ id: 'dinner', spentAt: '2026-10-07T19:00:00Z', amountInPolicyCurrency: 40000n }),
        expense({ id: 'breakfast', spentAt: '2026-10-07T08:00:00Z', amountInPolicyCurrency: 5000n }),
        expense({ id: 'next-day', localDate: '2026-10-08', amountInPolicyCurrency: 70000n }),
        expense({ id: 'taxi', category: 'ground_transport', amountInPolicyCurrency: 90000n }),
      ],
      [rule({ ruleType: 'daily_cap', category: 'meals', params: { amount: '80000' } })],
      KRW,
    );
    expect([...flags.keys()]).toEqual(['dinner']);
  });

  it('nightly_cap divides lodging by nights', () => {
    const rules = [rule({ ruleType: 'nightly_cap', category: 'lodging', region: 'JP', params: { amount: '250000' } })];
    const flags = evaluatePolicies(
      [
        expense({ id: 'ok', category: 'lodging', amountInPolicyCurrency: 600000n, nights: 3 }),
        expense({ id: 'over', category: 'lodging', amountInPolicyCurrency: 600000n, nights: 2 }),
        expense({ id: 'other-country', category: 'lodging', merchantCountry: 'US', amountInPolicyCurrency: 900000n }),
      ],
      rules,
      KRW,
    );
    expect([...flags.keys()]).toEqual(['over']);
  });

  it('prohibited_keyword matches merchant and line items case-insensitively', () => {
    const rules = [
      rule({ ruleType: 'prohibited_keyword', action: 'block', params: { keywords: ['beer', '주류'] } }),
    ];
    const flags = evaluatePolicies(
      [
        expense({ id: 'izakaya', lineItems: ['Edamame', 'Asahi BEER'] }),
        expense({ id: 'mart', merchantName: '편의점 주류코너' }),
        expense({ id: 'coffee', lineItems: ['Latte'] }),
      ],
      rules,
      KRW,
    );
    expect([...flags.keys()].sort()).toEqual(['izakaya', 'mart']);
    expect(worstAction(flags.get('izakaya'))).toBe('block');
  });

  it('receipt_required_over and weekend_flag', () => {
    const flags = evaluatePolicies(
      [
        expense({ id: 'no-receipt', hasReceipt: false, amountInPolicyCurrency: 40000n }),
        expense({ id: 'small-no-receipt', hasReceipt: false, amountInPolicyCurrency: 20000n }),
        expense({ id: 'saturday', localDate: '2026-10-10' }),
      ],
      [
        rule({ ruleType: 'receipt_required_over', params: { amount: '30000' } }),
        rule({ ruleType: 'weekend_flag', params: {} }),
      ],
      KRW,
    );
    expect(flags.get('no-receipt')?.map((f) => f.ruleType)).toEqual(['receipt_required_over']);
    expect(flags.has('small-no-receipt')).toBe(false);
    expect(flags.get('saturday')?.map((f) => f.ruleType)).toEqual(['weekend_flag']);
  });

  it('throws on malformed params instead of silently passing', () => {
    expect(() =>
      evaluatePolicies([expense({ id: 'a' })], [rule({ ruleType: 'per_item_cap', params: { amount: 5 } })], KRW),
    ).toThrow(PolicyRuleError);
  });
});

describe('worstAction', () => {
  it('orders block > require_justification > warn', () => {
    expect(worstAction(undefined)).toBeNull();
    expect(
      worstAction([
        { ruleId: 'a', ruleType: 'weekend_flag', action: 'warn', message: '' },
        { ruleId: 'b', ruleType: 'per_item_cap', action: 'require_justification', message: '' },
      ]),
    ).toBe('require_justification');
  });
});
