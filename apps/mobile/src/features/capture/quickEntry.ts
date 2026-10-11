import type { ExpenseCategory } from '../../domain/schemas';

/** What a one-line entry like "택시 12,000원" or "lunch $18.50" says. */
export interface QuickEntry {
  merchantName?: string;
  total?: string;
  currency?: string;
  category?: ExpenseCategory;
}

const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/^(원|₩|krw)$/i, 'KRW'],
  [/^(엔|円|¥|jpy)$/i, 'JPY'],
  [/^(달러|불|\$|usd)$/i, 'USD'],
  [/^(유로|€|eur)$/i, 'EUR'],
  [/^(위안|元|cny|rmb)$/i, 'CNY'],
  [/^(파운드|£|gbp)$/i, 'GBP'],
  [/^(동|₫|vnd)$/i, 'VND'],
  [/^(바트|฿|thb)$/i, 'THB'],
];

const CATEGORY_WORDS: Array<[RegExp, ExpenseCategory]> = [
  [/택시|버스|지하철|전철|기차|ktx|srt|철도|taxi|uber|grab|\bbus\b|subway|metro|train|タクシー|電車|バス|新幹線/i, 'ground_transport'],
  [/호텔|숙박|모텔|에어비앤비|hotel|airbnb|\binn\b|ホテル|宿泊/i, 'lodging'],
  [/항공|비행기|flight|airline|航空/i, 'airfare'],
  [/렌터카|렌트|rental car|rent-a-car|レンタカー/i, 'car_rental'],
  [/주유|기름|휘발유|경유|\bgas\b|fuel|petrol|ガソリン/i, 'fuel'],
  [/주차|parking|駐車/i, 'parking'],
  [/유심|로밍|통신|와이파이|\bsim\b|roaming|wifi|wi-fi/i, 'communication'],
  [/접대|회식|entertain|接待/i, 'entertainment'],
  [/문구|사무용품|office|文房具/i, 'office_supplies'],
  [/수수료|\bfees?\b|手数料/i, 'fees'],
  [/아침|점심|저녁|식사|식당|밥|커피|카페|간식|breakfast|lunch|dinner|meal|coffee|cafe|restaurant|朝食|昼食|夕食|ランチ|食事|カフェ|コーヒー/i, 'meals'],
];

// A number, optionally with a Korean 만/천 unit: "12,000", "18.50", "1.2만", "3천".
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(만|천)?/;

/** Reads a one-line note into confirm-card fields; anything it can't tell is left out. */
export function parseQuickEntry(text: string): QuickEntry {
  const out: QuickEntry = {};
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const rest: string[] = [];

  for (const raw of tokens) {
    // Split "$18.50", "12,000원", "¥3200" into symbol + number + word.
    const m = raw.match(/^([$€£¥₩₫฿]?)(\d[\d,]*(?:\.\d+)?)(만|천)?(\S*)$/);
    if (m && out.total === undefined) {
      const [, prefix, digits, unit, suffix] = m;
      let value = Number(digits!.replace(/,/g, ''));
      if (unit === '만') value *= 10_000;
      if (unit === '천') value *= 1_000;
      if (value > 0) {
        out.total = String(Math.round(value * 100) / 100);
        const word = (prefix || suffix || '').trim();
        const hit = word && CURRENCY_WORDS.find(([re]) => re.test(word));
        if (hit) out.currency = hit[1];
        continue;
      }
    }
    const currency = CURRENCY_WORDS.find(([re]) => re.test(raw));
    if (currency && out.total !== undefined && !out.currency) {
      out.currency = currency[1];
      continue;
    }
    rest.push(raw);
  }

  if (out.total === undefined) {
    const m = text.match(AMOUNT);
    if (m) out.total = m[1]!.replace(/,/g, '');
  }
  const merchant = rest.join(' ').trim();
  if (merchant) out.merchantName = merchant;
  const category = CATEGORY_WORDS.find(([re]) => re.test(text));
  if (category) out.category = category[1];
  return out;
}
