import { PLANS, TERMS_VERSION } from './premium-store.js';

export const EXPERIMENT_VERSION = 'stars-brands-2026-11-17-v1';
export const MAX_INVOICE_STARS = 18000;
export const DAILY_SPEND_LIMIT = 18000;
export const MAX_PREPAID_DAYS = 365;
const prices = Object.freeze({
  english: [1, 3, 7], focus: [5, 15, 35], game: [15, 45, 99],
  budget: [25, 75, 180], hub: [75, 225, 540], task: [250, 750, 1800],
  quiz: [750, 2250, 5400], party: [2500, 7500, 18000]
});

export function paymentConfiguration(brandId = 'anon') {
  if (brandId === 'anon') return Object.freeze({ brandId, plans: PLANS, termsVersion: TERMS_VERSION });
  if (!Object.hasOwn(prices, brandId)) throw new Error('unknown_payment_brand');
  const plans = Object.freeze(Object.fromEntries(Object.entries(PLANS).map(([key, plan], i) => {
    const stars = prices[brandId][i];
    if (!Number.isSafeInteger(stars) || stars < 1 || stars > MAX_INVOICE_STARS) throw new Error('invalid_price');
    return [key, Object.freeze({ ...plan, stars })];
  })));
  return Object.freeze({ brandId, plans, termsVersion: EXPERIMENT_VERSION, adultOnly: true,
    dailySpendLimit: DAILY_SPEND_LIMIT, maxPrepaidDays: MAX_PREPAID_DAYS });
}

// An explicit allowlist supports staged rollout and a reversible sales-only stop.
// Receipts, refunds, support and reconciliation remain available when sales stop.
export function variantSalesEnabled(id, value = process.env.ANON_VARIANT_STARS_ENABLED || '') {
  return value.split(',').map(s => s.trim()).includes(id) || value.trim() === 'all';
}
