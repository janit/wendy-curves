import type { WendyHistoryRow } from "./types.ts";

export interface ArchiveDayMeta {
  date: string;
  row_count: number;
  ts_start: number;
  ts_end: number;
  format: string;
  created_at: number;
}

export interface WendySource {
  fetchHistory(fromTs: number, toTs: number, source: string | null): Promise<WendyHistoryRow[]>;
  openEventStream(onEvent: (data: unknown) => void, onError: (err: Error) => void): () => void;
  fetchArchiveDays?(from: string, to: string): Promise<ArchiveDayMeta[]>;
  fetchArchiveDay?(date: string, source: string | null): Promise<WendyHistoryRow[]>;
}

export class HttpWendySource implements WendySource {
  constructor(private baseUrl: string, private secret: string | null) {}

  async fetchHistory(fromTs: number, toTs: number, source: string | null): Promise<WendyHistoryRow[]> {
    const url = new URL("/api/history", this.baseUrl);
    url.searchParams.set("from", String(fromTs));
    url.searchParams.set("to", String(toTs));
    if (source) url.searchParams.set("source", source);

    const headers: Record<string, string> = {};
    if (this.secret) headers.authorization = `Bearer ${this.secret}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`history fetch failed: ${res.status} ${res.statusText}`);
    return await res.json() as WendyHistoryRow[];
  }

  openEventStream(onEvent: (data: unknown) => void, onError: (err: Error) => void): () => void {
    const url = new URL("/api/events", this.baseUrl).toString();
    const es = new EventSource(url);
    let closed = false;
    es.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    };
    es.onerror = (_ev) => {
      if (!closed) {
        onError(new Error("EventSource error"));
      }
    };
    return () => {
      closed = true;
      es.close();
    };
  }

  async fetchArchiveDays(from: string, to: string): Promise<ArchiveDayMeta[]> {
    const url = new URL("/api/archive/days", this.baseUrl);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    const headers: Record<string, string> = {};
    if (this.secret) headers.authorization = `Bearer ${this.secret}`;

    const res = await fetch(url, { headers });
    if (res.status === 503) { await res.body?.cancel(); return []; }  // archive not enabled — degrade gracefully
    if (!res.ok) throw new Error(`fetchArchiveDays failed: ${res.status} ${res.statusText}`);
    return await res.json() as ArchiveDayMeta[];
  }

  async fetchArchiveDay(date: string, source: string | null): Promise<WendyHistoryRow[]> {
    const url = new URL(`/api/archive/day/${date}`, this.baseUrl);
    if (source) url.searchParams.set("source", source);

    const headers: Record<string, string> = {};
    if (this.secret) headers.authorization = `Bearer ${this.secret}`;

    const res = await fetch(url, { headers });
    if (res.status === 503 || res.status === 404) { await res.body?.cancel(); return []; }  // archive disabled or day missing
    if (!res.ok) throw new Error(`fetchArchiveDay ${date} failed: ${res.status} ${res.statusText}`);
    return await res.json() as WendyHistoryRow[];
  }
}
