-- Extends campaign_changes_log (0007) for Track B: the PPC agent now needs
-- to not just recommend a change but, given explicit human approval, apply
-- it itself via the Google Ads/Yandex Direct write APIs (see
-- packages/agents/ppc's new "recommend"/"apply"/"verify" actions) and later
-- read back what it did to self-evaluate. The existing table already has
-- the right grain (one row per change) — this ALTERs it rather than adding
-- a parallel "applied_changes" table, so a later "verify" run never needs a
-- join to find out what it itself proposed and applied.
--
-- status default 'proposed' matches today's reality: every existing row was
-- written by .claude/agents/medavenue-analyst.md's read-only recommend-only
-- workflow, so backfilling old rows to 'proposed' is correct, not a guess.

alter table campaign_changes_log
  add column status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'applied', 'apply_failed')),
  add column proposed_by_run_id text,
  add column approved_by text,
  add column approved_at timestamptz,
  -- Structured snapshot from ad_stat at proposal time and again at
  -- verification time, machine-comparable alongside the existing free-text
  -- expected_effect/actual_effect (kept as-is for the human-readable
  -- summary — these do not replace them).
  add column before_metrics jsonb,
  add column after_metrics jsonb,
  -- Raw response/resource-name/error from the actual mutate call, so a
  -- failed apply can be debugged without re-deriving it from logs.
  add column apply_result jsonb;

create index campaign_changes_log_status_idx on campaign_changes_log (client_ad_account_id, status);

-- Known limitation (stated, not hidden): apply_result/before_metrics/
-- after_metrics are unstructured jsonb — if a specific shape turns out to
-- matter across many rows, add typed columns later rather than guessing the
-- full shape today (same stance as 0007's own closing comment).
