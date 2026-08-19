-- Real finding (2026-08-19): ad_stat had no currency column at all —
-- Google Ads (Медавеню: USD) and Yandex Direct (Медавеню: BYN) cost
-- values were being stacked on the same dashboard axis as if
-- interchangeable. conversions_total is a plain numeric sum of the
-- conversions jsonb column's values, computed at sync time — DataLens's
-- native PostgreSQL connector has no easy way to aggregate an arbitrary
-- JSON object's values itself, and different clients approve different
-- conversion sets, so summing at write-time (not read-time) is what
-- makes "conversions" chartable at all.
alter table ad_stat add column currency text;
alter table ad_stat add column conversions_total numeric not null default 0;
