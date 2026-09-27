# Maintenance — 2026-09-27

## Scope

Production is on Terra in `D:\Projects\TerraTectra-production\anon-gender-chat-ru\bot`. Home PC was not accessed. No credentials, payment secrets or user transcripts were printed or committed.

## Findings and changes

- Telegram request timeouts, expired callback acknowledgements, redundant message edits and repeated daily-report timeouts were present in the ongoing September 24 log.
- Default long sequential processing could stall unrelated conversations. Main-bot polling now uses grammY runner with concurrency 24, per-user ordering and current-pair/matchmaking dependencies.
- Ordinary API requests have a 12-second deadline; polling and media uploads have separate limits. Potentially delivered messages are not automatically retried.
- Callback acknowledgement failures no longer cancel the action. Unchanged edits are harmless; non-editable messages get a new response.
- Telegram's abort-controller polyfill requires event bridging, not native AbortSignal.any. An actual initial startup failure exposed this and was corrected. Delayed startup cannot create a poller after shutdown.
- Temporary relay failures preserve the active pair. Confirmed user blocks remove stale queue entries and close an affected conversation.
- Both matched users are notified independently, so failure to notify one does not skip the other.
- The last search mode is persisted. Next preserves age-only filters, and random search does not unexpectedly inherit an old gender filter.
- Exhausted filtered quota is checked before disconnecting an existing chat. The free quota remains 50 successful filtered matches per day.
- Stale profile/filter/report buttons cannot silently alter an active profile or report a new conversation partner.
- Daily reports are single-flight with exponential retry backoff up to 15 minutes. Report content was not expanded with extra metrics.
- Health includes the actual anonymous-poller state, PID, uptime and aggregate API timings. Shutdown drains active handlers and archive work before closing stores.

## Data safety and validation

Nine production SQLite databases and the separate sessions.sqlite archive passed quick_check. The archive files and consistent database backups were saved outside the repository under:
`D:\Projects\TerraTectra-production\backups\anon-premium-2026-09-27T18-44-57.803Z`.

Baseline: 102 automated tests passed. Added regression tests cover search mode, quota, blocked recipients, temporary delivery failures, stale callbacks, concurrent conversations, request deadlines, report backoff, polyfilled abort signals and shutdown during init. Full test logs and read-only live verification are outside the repository in `D:\Projects\TerraTectra-production`.

The initial live restart retained the active pair and all registrations; no asymmetric or mixed minor/adult pairs were found. No real purchase or refund was performed.

## Premium and payments — NOT deployed

The user's requested premium is not active. Two attempts to write its payment module were blocked by the tool safety check. No payment module, invoice handler or premium entitlement was installed; no payment was collected. The live verification explicitly checks premiumModulePresent=false.

Proposed, not activated prices: 25 Stars / 7 days; 75 Stars / 30 days; 180 Stars / 90 days, without automatic renewal. Proposed benefits: unlimited gender/age-filtered matching and viewing voluntarily disclosed self-reported gender/age. Existing profile data must not silently become visible to strangers; add explicit disclosure controls and preserve the 12–17 / 18+ separation.

A future payment implementation must use Telegram Stars (XTR), require clear terms before purchase, answer pre-checkout promptly, grant only after successful_payment, persist and deduplicate the Telegram charge ID, extend existing time atomically, support /paysupport and authorized refunds, and test failure/replay/restart paths. A separate acquiring provider token is not required for Stars.

Official references: Telegram Bot Payments for Digital Goods and Services; grammY runner documentation. This document records an unfinished premium requirement, not a claim that billing is available.

## Verified release state

At 19:02 UTC on 2026-09-27 the new Terra process was running with active polling, no queued Telegram updates, an intact existing pair, and zero asymmetric or mixed minor/adult pairs. All 120 tests passed (0 failures); all source JavaScript files passed syntax checks. Main-bot API metrics reported no request errors in the initial running window. A separate read-only getMe probe had one 8-second timeout followed by successful responses, so external connectivity is still intermittent and is not claimed to be permanently fixed.
