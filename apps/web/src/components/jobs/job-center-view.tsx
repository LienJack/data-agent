"use client";

import { type JobRecord, jobRecordSchema } from "@data-agent/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

const jobListResponseSchema = z.strictObject({ jobs: z.array(jobRecordSchema) });

const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"]);

function statusTone(status: JobRecord["status"]): string {
  if (status === "SUCCEEDED") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "FAILED" || status === "DEAD_LETTER")
    return "bg-rose-50 text-rose-800 border-rose-200";
  if (status === "CANCELLED" || status === "CANCEL_REQUESTED")
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function JobCenterView({ workspaceId }: { readonly workspaceId: string }) {
  const [jobs, setJobs] = useState<readonly JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/jobs?limit=50`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("JOB_LIST_UNAVAILABLE");
      const body = jobListResponseSchema.parse(await response.json());
      setJobs(body.jobs);
      setError(null);
    } catch {
      setError("任务列表暂时不可用，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeCount = useMemo(() => jobs.filter((job) => !terminal.has(job.status)).length, [jobs]);

  async function cancel(jobId: string) {
    setCancelling(jobId);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotency_key: `job-cancel:${jobId}` }),
      });
      if (!response.ok) throw new Error("JOB_CANCEL_FAILED");
      await load();
    } catch {
      setError("取消请求未被接受；任务状态可能已变化。");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-8 md:py-10">
      <header className="grid gap-6 border-b border-[var(--color-border-default)] pb-7 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Background authority
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[var(--color-text-primary)]">
            任务中心
          </h1>
          <p className="mt-3 max-w-[65ch] text-sm leading-6 text-[var(--color-text-secondary)]">
            这里展示 PostgreSQL 已接纳的后台任务。任务状态、租约、重试与输出回执均由数据库签发。
          </p>
        </div>
        <div className="border-l border-[var(--color-border-default)] pl-5">
          <div className="font-mono text-3xl font-semibold tabular-nums">{activeCount}</div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">当前非终态任务</div>
        </div>
      </header>

      {error && (
        <div className="mt-6 border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <section className="mt-8" aria-live="polite">
        {loading ? (
          <div className="divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="grid animate-pulse gap-3 py-5 md:grid-cols-[1fr_180px_120px]"
              >
                <div className="h-4 w-48 bg-slate-200" />
                <div className="h-4 w-28 bg-slate-100" />
                <div className="h-4 w-20 bg-slate-100" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="border-y border-[var(--color-border-default)] py-16">
            <p className="text-lg font-medium">尚无后台任务</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              从 Artifact Workspace 发起导出后，任务会出现在这里。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
            {jobs.map((job) => (
              <article
                key={job.job_id}
                className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_180px_150px] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-sm font-semibold tracking-[-0.01em]">{job.kind}</h2>
                    <span
                      className={`border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusTone(job.status)}`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                    {job.job_id}
                  </p>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  <div>
                    attempt {job.attempt_count} / {job.max_attempts}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                    fence {job.worker_fence}
                  </div>
                </div>
                <div className="md:text-right">
                  {!terminal.has(job.status) && job.cancel_policy === "COOPERATIVE" ? (
                    <button
                      type="button"
                      disabled={cancelling === job.job_id}
                      onClick={() => void cancel(job.job_id)}
                      className="border border-[var(--color-border-default)] px-3 py-2 text-xs font-medium transition-transform active:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cancelling === job.job_id ? "正在请求取消" : "取消任务"}
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(job.updated_at).toLocaleString("zh-CN")}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
