# Telegram Stars: eight brand experiment

All prices are fixed integer **Telegram Stars (XTR)**. Purchases are one-time, without subscriptions or automatic renewal. The original bot keeps its 25 / 75 / 180 Stars schedule and original payment records. Each experimental bot uses its own SQLite ledger, access and refund balance.

| Brand / ID | 7 days | 30 days | 90 days |
|---|---:|---:|---:|
| Искра / english | 1 | 3 | 7 |
| Полночь / focus | 5 | 15 | 35 |
| На волне / game | 15 | 45 | 99 |
| Без имени / budget | 25 | 75 | 180 |
| Тихая комната / hub | 75 | 225 | 540 |
| Откровенно / task | 250 | 750 | 1800 |
| Диалог 24 / quiz | 750 | 2250 | 5400 |
| Просто поговорим / party | 2500 | 7500 | 18000 |

These are different fixed prices by brand, not randomized individual pricing. Brand, traffic, queue size and price are confounded; small conversion samples must not be presented as proof of a price effect. Prices in rubles are not promised: Telegram's Star acquisition costs vary.

## Purchase and safeguards

Experimental purchases require a completed self-declared profile aged 18+. Minor users retain the free chat; premium does not bypass the 12–17 / 18+ boundary, bans or moderation. This is a self-declaration safeguard, not verified age assurance or a legal eligibility determination.

The buyer sees all prices, benefits, bot scope, lack of renewal, refund/support route and selected total before pressing an explicit adult/terms consent button. Expensive plans additionally show a high-price warning. No eligible partner or waiting-time guarantee is sold.

The order snapshots user, receiving bot, plan, days, Stars, brand, terms/pricing version and age. Consent and adult confirmation have timestamps. The order expires after 15 minutes. A subsequent schedule change does not reprice an existing order. Invoices are private, single-buyer XTR invoices with one price line, empty provider token and a nonempty start parameter. New pending orders supersede older pending orders; a second invoice dispatch for an order is blocked. Approved checkout reservations block a second purchase flow. Independent checkout IDs for the same order are rejected.

Experimental limits: at most 18,000 Stars per invoice and per buyer per rolling 24 hours in the same bot, counting gross purchases including refunds; at most 365 prepaid days ahead. Checkout rechecks caps, age, consent, identity, currency, exact quoted amount, expiry and state. Payment success is the only grant trigger. Unique charge and order constraints plus transactions prevent duplicate credit.

## Refunds, reconciliation and support

Successful receipts and refunds are handled even while sales are disabled. Each public bot reconciles its own Telegram ledger at startup and every five minutes. Persisted pagination and idempotent application cover records beyond the first 1,000. Restored access uses the original Telegram payment timestamp. Refund-before-receipt tombstones prevent later access grants. Mismatched receipts are retained for review.

The existing ADMIN_IDS private-chat check guards the whole administrative surface. `/payments`, `/balance` and the payment menu show all nine brands and measured seven-day funnel/revenue counters. A brand card retrieves its actual Telegram balance. Failed lookups remain unavailable, never zero. The original bot retains `payments:home`, `/refund`, `/reconcile_payments`, `/payreply` and `/payclose` compatibility.

Experimental payment cards include the bot name, order, buyer and amount. Refund confirmation is bound to administrator, order and a ten-minute window, and is routed through the original receiving bot's API. A bot-ID mismatch blocks the refund. Local access changes only after confirmed refund or reconciliation. Only the refunded purchase is removed from the entitlement calculation.

`/payment_support` combines open requests; `/payreply_chat english 1 text` answers request 1 through Искра; `/payclose_chat english 1` closes that exact request. Bot notifications identify their source brand. `/paysupport` remains available to banned users and minors. No real charge/refund is used in automated tests.

Analytics retain unique menu viewers, order creators and consenting users, buyers, payment count, gross Stars and refunded Stars for each bot. Menu-to-purchase conversion counts distinct buyers with a preceding menu view within the same seven-day window. Historical periods before event instrumentation have incomplete funnel data. Orders preserve the experiment version for later analysis.

## Controlled rollout and rollback

1. Back up all databases with SQLite backup (including all nine session archives), media, private configuration, logs and source revision. Verify every backup and retain its manifest privately.
2. Run tests on the candidate and exercise unified archive/deletion on copies, never on real user sessions for a test.
3. Require green GitHub CI, deploy the reviewed source with `ANON_VARIANT_STARS_ENABLED=` empty. Restart only the verified bot process; the existing background runner restarts it without dropping pending updates. Check all nine public polling metrics, identities, database integrity and reconciliation cursors.
4. Set `ANON_VARIANT_STARS_ENABLED=english`, restart and verify the canary. Then use `all` and verify all eight. Check original payments and pairs remain valid. Do not alter VPN, games, system settings or legacy niche databases.
5. Sales rollback: clear `ANON_VARIANT_STARS_ENABLED` and restart. Keep the new receipt/refund/reconciliation code and additive schema. **Never restore an old payment database over a live one**: that could discard accepted charges. A source rollback also requires checking outstanding experiment orders and preserving their handlers.

The single-session archive deletion confirmation is additionally bound to the requesting administrator with a two-minute expiry. Bulk deletion retains its two-step confirmation, short-lived snapshot and active/favorite protection.

Official references: [Stars payments](https://core.telegram.org/bots/payments-stars), [Bot API](https://core.telegram.org/bots/api#payments), [Stars terms](https://telegram.org/tos/stars). A production diagnostic invoice may use an unrecognized payload without publishing its URL: it has no valid checkout order and must be rejected. This validates Telegram's invoice format only, not a real payment round trip.
