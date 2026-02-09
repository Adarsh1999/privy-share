"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LockoutStatus, PublicVaultItem } from "@/lib/types";

type AuthStateResponse = {
  authenticated: boolean;
  lockout: LockoutStatus;
};

type ItemsResponse = {
  items: PublicVaultItem[];
};

type ApiError = {
  error: string;
  lockout?: LockoutStatus;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatBytes = (value: number | null): string | null => {
  if (value == null) {
    return null;
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(1)} ${units[index]}`;
};

const parseError = async (response: Response): Promise<ApiError> => {
  try {
    return (await response.json()) as ApiError;
  } catch {
    return { error: "Request failed" };
  }
};

const typeLabel = (kind: PublicVaultItem["kind"]): string => {
  if (kind === "text") {
    return "Text";
  }

  if (kind === "link") {
    return "Link";
  }

  if (kind === "image") {
    return "Image";
  }

  return "File";
};

export function PrivyApp() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [lockout, setLockout] = useState<LockoutStatus | null>(null);
  const [items, setItems] = useState<PublicVaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [timeNow, setTimeNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lockout?.isLocked) {
      return;
    }

    const interval = window.setInterval(() => {
      setTimeNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [lockout?.isLocked]);

  const refreshItems = useCallback(async () => {
    const response = await fetch("/api/items", {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 401) {
      setAuthenticated(false);
      setItems([]);
      return;
    }

    if (!response.ok) {
      const parsed = await parseError(response);
      throw new Error(parsed.error || "Failed to fetch items");
    }

    const data = (await response.json()) as ItemsResponse;
    setItems(data.items);
  }, []);

  const refreshState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/state", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const parsed = await parseError(response);
        throw new Error(parsed.error || "Failed to fetch state");
      }

      const data = (await response.json()) as AuthStateResponse;
      setAuthenticated(data.authenticated);
      setLockout(data.lockout);

      if (data.authenticated) {
        await refreshItems();
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to load app state";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [refreshItems]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const lockedSeconds = useMemo(() => {
    if (!lockout?.isLocked) {
      return 0;
    }

    return Math.max(0, Math.ceil((lockout.lockUntilEpochMs - timeNow) / 1000));
  }, [lockout, timeNow]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyAction) {
      return;
    }

    setBusyAction("login");
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const parsed = await parseError(response);
        if (parsed.lockout) {
          setLockout(parsed.lockout);
        }
        throw new Error(parsed.error || "Login failed");
      }

      setCode("");
      await refreshState();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Login failed";
      setError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction("logout");
    setError(null);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });

      setAuthenticated(false);
      setItems([]);
      await refreshState();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Logout failed";
      setError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const submitForm = async (
    event: React.FormEvent<HTMLFormElement>,
    actionName: "create-text" | "create-link" | "create-file",
  ) => {
    event.preventDefault();
    if (busyAction) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    const kind = actionName === "create-text" ? "text" : actionName === "create-link" ? "link" : "file";
    formData.set("kind", kind);

    setBusyAction(actionName);
    setError(null);

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const parsed = await parseError(response);
        if (response.status === 401) {
          setAuthenticated(false);
        }
        throw new Error(parsed.error || "Failed to create item");
      }

      form.reset();
      await refreshItems();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to create item";
      setError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (busyAction) {
      return;
    }

    setBusyAction(`delete:${id}`);
    setError(null);

    try {
      const response = await fetch(`/api/items/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const parsed = await parseError(response);
        if (response.status === 401) {
          setAuthenticated(false);
          setItems([]);
        }
        throw new Error(parsed.error || "Delete failed");
      }

      await refreshItems();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Delete failed";
      setError(message);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8">
        <div className="rounded-2xl border border-white/20 bg-white/70 px-6 py-5 text-sm text-slate-700 shadow-[0_16px_60px_rgba(7,27,44,0.15)] backdrop-blur">
          Loading Privy Share...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-7 rounded-3xl border border-white/20 bg-white/70 p-5 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Private Utility</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Privy Share</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-700 sm:text-base">
              Keep print-ready text, links, and files in one locked vault. Only a current authenticator code can unlock access.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-900 px-4 py-3 text-xs font-medium text-slate-100 shadow-lg">
            Status: {authenticated ? "Unlocked" : "Locked"}
          </div>
        </div>
      </header>

      {error ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      {!authenticated ? (
        <section className="mx-auto w-full max-w-lg rounded-3xl border border-white/20 bg-white/75 p-6 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-7">
          <h2 className="text-xl font-semibold text-slate-900">Unlock with Authenticator Code</h2>
          <p className="mt-2 text-sm text-slate-700">
            Open Microsoft Authenticator, read the current 6-digit code, and enter it here.
          </p>

          {lockout?.isLocked ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Locked due to repeated failures. Try again in {lockedSeconds}s.
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              Failed attempts: {lockout?.failedAttempts ?? 0}/{lockout?.maxAttempts ?? 10}
            </p>
          )}

          <form className="mt-5 space-y-4" onSubmit={handleLogin}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">Authenticator code</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9\s]/g, ""))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                maxLength={8}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg tracking-[0.2em] text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                disabled={Boolean(busyAction) || Boolean(lockout?.isLocked)}
              />
            </label>

            <button
              type="submit"
              disabled={Boolean(busyAction) || Boolean(lockout?.isLocked)}
              className="w-full rounded-xl bg-sky-700 px-4 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === "login" ? "Verifying..." : "Unlock vault"}
            </button>
          </form>
        </section>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-6">
            <article className="rounded-3xl border border-white/20 bg-white/75 p-5 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900">Save Text</h2>
              <form className="mt-4 space-y-3" onSubmit={(event) => submitForm(event, "create-text")}>
                <input
                  name="title"
                  placeholder="Title (optional)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <textarea
                  name="text"
                  required
                  rows={4}
                  placeholder="Paste the text you need to access on public PCs"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <button
                  type="submit"
                  disabled={Boolean(busyAction)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {busyAction === "create-text" ? "Saving..." : "Save text"}
                </button>
              </form>
            </article>

            <article className="rounded-3xl border border-white/20 bg-white/75 p-5 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900">Save Link</h2>
              <form className="mt-4 space-y-3" onSubmit={(event) => submitForm(event, "create-link")}>
                <input
                  name="title"
                  placeholder="Title (optional)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <input
                  name="url"
                  required
                  type="url"
                  placeholder="https://..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Short note (optional)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <button
                  type="submit"
                  disabled={Boolean(busyAction)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {busyAction === "create-link" ? "Saving..." : "Save link"}
                </button>
              </form>
            </article>

            <article className="rounded-3xl border border-white/20 bg-white/75 p-5 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900">Upload File or Image</h2>
              <form className="mt-4 space-y-3" onSubmit={(event) => submitForm(event, "create-file")}>
                <input
                  name="title"
                  placeholder="Title (optional)"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
                <input
                  name="file"
                  required
                  type="file"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
                />
                <button
                  type="submit"
                  disabled={Boolean(busyAction)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {busyAction === "create-file" ? "Uploading..." : "Upload file"}
                </button>
              </form>
            </article>
          </div>

          <aside className="rounded-3xl border border-white/20 bg-white/75 p-5 shadow-[0_24px_80px_rgba(7,27,44,0.15)] backdrop-blur sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Vault Items</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void refreshItems()}
                  disabled={Boolean(busyAction)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={Boolean(busyAction)}
                  className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
                >
                  {busyAction === "logout" ? "Signing out..." : "Lock"}
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
                Nothing here yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-100">
                        {typeLabel(item.kind)}
                      </span>
                      <span className="text-xs text-slate-500">{formatDate(item.createdAt)}</span>
                    </div>

                    {item.title ? <p className="mb-1 text-sm font-semibold text-slate-900">{item.title}</p> : null}

                    {item.kind === "text" && item.text ? (
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                        {item.text}
                      </pre>
                    ) : null}

                    {item.kind === "link" && item.linkUrl ? (
                      <div className="space-y-1">
                        <a
                          className="break-all text-sm font-medium text-sky-700 underline"
                          href={item.linkUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {item.linkUrl}
                        </a>
                        {item.linkNote ? <p className="text-xs text-slate-600">{item.linkNote}</p> : null}
                      </div>
                    ) : null}

                    {(item.kind === "file" || item.kind === "image") && item.downloadUrl ? (
                      <div className="space-y-2">
                        {item.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={item.fileName || "Image"}
                            src={item.downloadUrl}
                            className="max-h-44 w-full rounded-lg object-cover"
                          />
                        ) : null}
                        <a
                          className="inline-flex rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800"
                          href={item.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open file
                        </a>
                        <p className="text-xs text-slate-600">
                          {[item.fileName, formatBytes(item.sizeBytes)].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void handleDelete(item.id)}
                        disabled={Boolean(busyAction)}
                        className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        {busyAction === `delete:${item.id}` ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </section>
      )}
    </div>
  );
}
