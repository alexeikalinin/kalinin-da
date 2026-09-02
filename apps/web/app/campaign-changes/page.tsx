"use client";

import { useEffect, useState } from "react";

// Track B review screen — same minimal-on-purpose stance as
// app/prospects/page.tsx. Lists campaign_changes_log rows proposed by
// ppc-agent's "recommend" action; approve triggers real "apply" against
// the live ad account (see /api/campaign-changes/[id]/approve), reject
// just marks it 'rejected'.
interface CampaignChangeRow {
  readonly id: string;
  readonly client_ad_account_id: string;
  readonly campaign_id: string | null;
  readonly campaign_name: string | null;
  readonly change_type: string;
  readonly change_description: string;
  readonly expected_effect: string | null;
  readonly status: string;
  readonly created_at: string;
}

export default function CampaignChangesReviewPage() {
  const [changes, setChanges] = useState<readonly CampaignChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/campaign-changes?status=proposed");
      const data = (await res.json()) as CampaignChangeRow[] | { error: string };
      if (!res.ok) throw new Error((data as { error: string }).error);
      setChanges(data as CampaignChangeRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(id: string, action: "approve" | "reject") {
    setActioning(id);
    try {
      const res = await fetch(`/api/campaign-changes/${id}/${action}`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok && res.status !== 207) throw new Error(data.error ?? `${action} failed`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActioning(null);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Рекомендации по кампаниям — на одобрение</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading && <p>Загрузка…</p>}
      {!loading && changes.length === 0 && <p>Нет рекомендаций, ожидающих одобрения.</p>}
      {changes.map((c) => (
        <section key={c.id} style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Аккаунт: {c.client_ad_account_id} · Кампания: {c.campaign_name ?? c.campaign_id ?? "—"} · {new Date(c.created_at).toLocaleString()}
          </p>
          <p>
            <strong>{c.change_type}</strong>
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.change_description}</p>
          {c.expected_effect && <p style={{ color: "#2a7" }}>Ожидаемый эффект: {c.expected_effect}</p>}
          <button onClick={() => void act(c.id, "approve")} disabled={actioning === c.id} style={{ marginRight: "0.5rem" }}>
            Одобрить и применить
          </button>
          <button onClick={() => void act(c.id, "reject")} disabled={actioning === c.id}>
            Отклонить
          </button>
        </section>
      ))}
    </main>
  );
}
