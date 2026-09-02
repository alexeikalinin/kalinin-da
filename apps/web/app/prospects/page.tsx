"use client";

import { useEffect, useState } from "react";

// Track A review screen — minimal on purpose (Plan §2: "минимальные
// dashboard-страницы (таблица + кнопки)"). Lists outreach_message rows
// awaiting human approval; approve triggers a real send (see
// /api/outreach/[id]/approve), reject just marks it 'rejected'. No styling
// framework in this app yet (same plain-inline-style convention as
// app/privacy/page.tsx) — this is a working review tool, not a polished UI.
interface OutreachMessageRow {
  readonly id: string;
  readonly prospect_agency_id: string;
  readonly subject: string | null;
  readonly body_text: string;
  readonly status: string;
  readonly drafted_at: string;
}

export default function ProspectsReviewPage() {
  const [messages, setMessages] = useState<readonly OutreachMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/outreach?status=pending_approval");
      const data = (await res.json()) as OutreachMessageRow[] | { error: string };
      if (!res.ok) throw new Error((data as { error: string }).error);
      setMessages(data as OutreachMessageRow[]);
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
      const res = await fetch(`/api/outreach/${id}/${action}`, { method: "POST" });
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
      <h1>Outreach — на одобрение</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading && <p>Загрузка…</p>}
      {!loading && messages.length === 0 && <p>Нет черновиков, ожидающих одобрения.</p>}
      {messages.map((m) => (
        <section key={m.id} style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Prospect: {m.prospect_agency_id} · Черновик от {new Date(m.drafted_at).toLocaleString()}
          </p>
          <p>
            <strong>{m.subject}</strong>
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{m.body_text}</p>
          <button onClick={() => void act(m.id, "approve")} disabled={actioning === m.id} style={{ marginRight: "0.5rem" }}>
            Одобрить и отправить
          </button>
          <button onClick={() => void act(m.id, "reject")} disabled={actioning === m.id}>
            Отклонить
          </button>
        </section>
      ))}
    </main>
  );
}
