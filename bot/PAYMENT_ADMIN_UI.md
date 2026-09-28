# Payment administration

The private administrator bot exposes permanent Stars payment controls for premium purchases only.

- /payments or /balance shows the live Stars balance of @anon_gender_chat_ru_bot, active premium count, payment review count, and recent premium purchases.
- Selecting a premium purchase opens its payment card.
- Refunds require an explicit first action and a separate confirmation action.
- /payment_support lists open payment-support requests.
- /payreply and /payclose handle support tickets.
- /reconcile_payments runs ledger reconciliation against Telegram.

The administrator UI is restricted to configured ADMIN_IDS in private chat. A failed balance lookup is shown as unavailable, never as zero. A Telegram refund is recorded locally only after Telegram confirms it; retry/reconciliation paths are idempotent.

The temporary 8-Star owner test was completed and refunded on 28.09.2026 and then retired. Its historical SQLite rows remain for audit only and are intentionally excluded from this permanent interface.
