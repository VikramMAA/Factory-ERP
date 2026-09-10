# CLAUDE.md — Non-negotiable invariants

> Copied verbatim from SPEC.md Section 3. Read this on every session before touching
> the database, the offline queue, or any weight/money field. These are not style
> preferences; several are enforced by database triggers and will reject writes that
> violate them.

1. **All weights are integers in grams.** Column names end in `_g`. Never store kilograms, never use floats for weight. Convert to kg at the display layer only.
2. **All money is integers in paise.** Column names end in `_paise`. Never use floats for money.
3. **`weighments` and `inventory_moves` are append-only.** No `UPDATE`, no `DELETE`, by anyone, including the owner. Corrections are new reversing rows. Database triggers enforce this. Do not add a policy or a bypass.
4. **Stock is derived, never stored.** Current stock is `sum(qty_delta)` over `inventory_moves`. Never create a mutable `stock_qty` column.
5. **Never trust the client clock.** Every event stores `device_ts` (from the phone) and `server_ts` (`DEFAULT now()`, forced by trigger). Divergence is a flag, not an error to hide.
6. **Never trust client-supplied identity.** `actor_id` is overwritten with `auth.uid()` by a `BEFORE INSERT` trigger on every event table.
7. **The `service_role` key never reaches the browser.** Only `VITE_SUPABASE_ANON_KEY` is bundled. Anything prefixed `VITE_` is public. Treat it as printed on the front door.
8. **Every mutation path goes through RLS.** No table gets a blanket `USING (true)` policy. If a screen needs data it cannot read, fix the policy, do not widen it.
9. **Idempotency by `client_uuid`.** The offline queue generates a UUID per event before the first send attempt. Retries reuse it. A unique constraint makes replay safe.
10. **Never destroy an operator's captured data.** A photo blob stays in IndexedDB until the server confirms the row insert.
11. **Flags are leads, never verdicts.** No UI copy accuses a person. Flag titles describe the measurement, not the motive.

See `SPEC.md` for full context, schema, RPCs, and the phased build plan. Build in phase
order (Section 13); do not start a phase until the previous phase's acceptance criteria
pass. Re-run `tests/sql/run.sh` after every migration change.
