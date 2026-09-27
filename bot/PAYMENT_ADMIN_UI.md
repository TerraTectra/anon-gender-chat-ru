# Stars balance and visible refund controls — 2026-09-27

The owner reported that the 8-Star test payment was missing from the refund UI. The test ledger is intentionally separate from premium entitlements, but the original administrator UI only queried premium_payments and offered refunds by command. This release bridges both ledgers without changing entitlement rules.

Read-only verification at 20:51 UTC: Telegram getMyStarBalance returned 8 Stars for @anon_gender_chat_ru_bot. The 8-Star incoming transaction matched the paid test order and its original payer/charge. No refund was found. The admin bot is @anon_gender_chat_ru_admin_bot. No real refund was issued during this development task.

## Navigation

Private admin main keyboard: «💳 Платежи». The anonymous-chat product view also contains «💳 Платежи и баланс». /payments and /balance show the actual receiving bot balance via getMyStarBalance, not a local sum and not the administrator bot's balance. If Telegram is unavailable, the view explicitly says that balance is unknown rather than displaying zero.

Select a paid premium or test order → payment card → «↩️ Вернуть N ⭐» → explicit confirmation with amount and original payer → «Подтвердить возврат N ⭐». /refund UUID is retained and now accepts both paid premium and paid test order IDs. Payment-support messages link back to the payment/refund panel.

The first click never calls refundStarPayment. Confirmations belong to the requesting administrator, expire after ten minutes and are invalidated by cancellation, use or process restart. Group chats and non-admins are rejected. A concurrent repeated click cannot issue another API call. The paying bot ID is verified before refund. Local refunded state changes only after Telegram returns true or its explicit already-refunded result. Notification failure cannot mislabel a completed refund as a failed refund.

Test refunds only update test_payment_orders and leave premium_access, free quotas, profiles and conversations unchanged. Turning off creation of new test invoices does not disable historical refund support. No additional invoice was created by this release.

## Verification and delivery

Existing tests plus payment-admin-panel.test.js cover balance formatting/failure, test/premium cards, private authorization, cancellation and confirmation ownership, duplicates, false/error Telegram responses, original charge selection, disabled test purchases, bot-identity mismatch, support navigation and unchanged entitlements. Tests mock actual refunds; the real 8-Star payment remains for the owner to refund interactively.

scripts/inspect-star-payments.mjs is read-only. scripts/show-owner-payment-panel.mjs --send updates administrator commands and sends the verified sole owner the current main-bot balance, refreshed keyboard and the existing test-payment card. It does not create an invoice, call getUpdates or issue a refund. Do not rerun it automatically after an ambiguous send timeout.

Official API reference: https://core.telegram.org/bots/api#getmystarbalance and https://core.telegram.org/bots/api#refundstarpayment .

## Verified deployment

All 205 automated tests passed; all source files passed syntax checks. Production restarted only after a database backup at 2026-09-27_21-00-36. The new Terra bot process 39008 received Telegram updates. Administrator commands were saved and read back. At 21:01 UTC the sole verified owner received the new balance/keyboard message (1134) and test payment card (1135) from @anon_gender_chat_ru_admin_bot; Telegram's returned message contained the actual refundask:t button. A subsequent read-only check confirmed the receiving bot balance was still 8 Stars, the incoming test transaction matched, refunded_ms remained null and no Telegram refund transaction existed. No refund was performed by the deployment script. Intermittent transport errors remain a separate pre-existing operational issue; this update does not claim to fix the network.
