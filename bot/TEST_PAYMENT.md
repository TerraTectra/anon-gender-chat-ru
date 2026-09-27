# Temporary owner-only test payment — 27 September 2026

Explicitly requested by the owner: a real payment of exactly 8 Telegram Stars named «Тестовая оплата», granting nothing. The owner confirms the charge in Telegram; no automated purchase is performed.

Implementation: src/test-payment.js. Independent SQLite test_payment_orders and test_payment_control tables; no writes to premium_access, filtered_usage or user profiles. Default disabled, enabled explicitly by the issue script. Only the configured administrator can request and pay the invoice. The temporary button appears only for that account in /premium; /testpay is also supported. Ordinary premium plans remain unchanged.

The single-use invoice is valid for 24 hours, reused for repeated requests, and bound to the buyer and bot. The pre-checkout handler checks exact XTR/8 amount and permission. Payment receipts are idempotent, are retained across restart and can be recovered using the existing Telegram transaction reconciliation. Refund notifications can be recorded without changing any premium entitlement. The temporary purchase button is hidden once payment is recorded. No real refund is initiated by this module.

Operations from bot directory:

- node scripts/issue-test-payment.mjs --enable-and-send: verify there is exactly one administrator and a private chat, enable test, send the invoice once and record its message ID. No automatic resend on a network error.
- node scripts/issue-test-payment.mjs --status: print safe state without tokens, user IDs or payment charge IDs.
- node scripts/issue-test-payment.mjs --disable: remove availability immediately without restarting; all unpaid test invoices are refused at checkout. Keep the handlers and ledger until any delayed receipts/refunds are handled. Do not delete payment history during removal.

Before deployment: new regression tests check the title/8-Star price, owner-only access, no entitlement/limit/profile/chat changes, idempotency, rejected malformed checkout, disable-after-approval receipts, refunds, reopening SQLite, ordinary premium compatibility and ledger reconciliation. Changes are restricted to Terra; Home PC is not used.

## Verified deployment

All 187 discovered tests passed, including 16 specific test-payment scenarios. Production restarted on Terra with successful Telegram polling and no errors in the initial health check. The owner received a real Telegram invoice titled «Тестовая оплата», XTR amount 8 (message ID 24433). Invoice delivery was confirmed by sendInvoice; issuing it did not change premium access. At the delivery check, checkout and payment were still pending. No purchase was executed by the assistant. Backup created before restart at 2026-09-27_20-20-58. Disable on the owner's next instruction using the documented command; preserve the receipt ledger.
