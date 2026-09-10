# Rewind Ops

Production, inventory, sales and delivery tracking for a thread rewinding factory.
Full build specification: [`SPEC.md`](./SPEC.md). Non-negotiable invariants that
must be re-read every session: [`CLAUDE.md`](./CLAUDE.md).

**Status: Phase 0 (Foundation)** — auth, roles, RLS, master data, immutability,
and the backup/keepalive jobs. See SPEC.md Section 13 for the full phase plan.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Database

Migrations live in `supabase/migrations/`, applied in filename order. Point the
Supabase CLI at your project and run `supabase db push`, or apply them directly
with `psql` against the project's connection string.

Before pushing a migration, verify it locally against a throwaway Postgres —
this is much faster than round-tripping through a real Supabase deploy and
catches the exact class of bug (trigger recursion, `format()` typos, missing
RLS policies) documented in SPEC.md Appendix C:

```bash
npm run test:sql   # tests/sql/run.sh
```

This creates a scratch `rewind_test` database, applies every migration and the
seed data, then runs the functional and RLS assertion suites.

## Secrets

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are ever bundled into the
client — see CLAUDE.md invariant 7. `vite.config.ts` fails the build if any
`VITE_`-prefixed variable looks like a secret (matches `SERVICE_ROLE|DB_URL|SECRET`).

GitHub repository secrets needed for the Actions workflows:

| Secret | Used by |
|---|---|
| `SUPABASE_DB_URL` | `.github/workflows/backup.yml` |
| `SUPABASE_SERVICE_ROLE_KEY` | photo purge job (Phase 5) |
| `SUPABASE_PROJECT_REF` | `.github/workflows/keepalive.yml` |
| `SUPABASE_ANON_KEY` | `.github/workflows/keepalive.yml` |

## Test users

Create one Supabase Auth user per role with a synthetic address
(`operator1@rewind.local`, etc.), email confirmation disabled, then add a
matching row to `profiles` and `user_roles`.
