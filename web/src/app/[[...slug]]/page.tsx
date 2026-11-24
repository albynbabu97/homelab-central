'use client';
import { useEffect, useState, Suspense, useTransition, type ReactNode } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { selfhIconUrl } from '@/lib/selfhIcon';
import {
  Activity,
  AppWindow,
  Bell,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cloud,
  Cpu,
  ExternalLink,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Monitor,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";

type Summary = {
  hostname?: string;
  uptime?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  containers?: { running: number; total: number };
  status?: string;
};
type AppItem = {
  id: string;
  name: string;
  url: string;
  category?: string;
  description?: string;
  healthStatus?: string;
  healthCheckUrl?: string;
  icon?: string;
  sortOrder?: number;
};
type AppDraft = {
  name: string;
  url: string;
  category: string;
  description: string;
  sortOrder: number;
  icon: string;
  healthCheckUrl: string;
};
type SystemAlert = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  read: boolean;
};
type NoticeTone = 'success' | 'error' | 'warning';
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: AppWindow },
  { id: "docker", label: "Docker", icon: Box },
  { id: "monitoring", label: "Server monitoring", icon: Activity },
  { id: "maintenance", label: "Maintenance", icon: Mail },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "domains", label: "Domains & SSL", icon: ShieldCheck },
  { id: "activity", label: "Activity logs", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j.data ?? j;
};
const appSubtitle = (a: AppItem) => {
  const category = a.category || 'Application';
  if (!a.healthStatus || a.healthStatus === 'unknown') return category;
  return `${category} · ${a.healthStatus}`;
};
const healthStatusClass = (status?: string) => {
  if (status === 'healthy') return 'healthy';
  if (status === 'degraded') return 'degraded';
  if (status === 'down') return 'down';
  return 'unknown';
};
const notifUpdateKey = (u: { id?: string; name?: string }) =>
  `update:${u.id || u.name || 'unknown'}`;
const copyText = async (text: string, onNotice: (s: string, tone?: NoticeTone) => void) => {
  try {
    await navigator.clipboard.writeText(text);
    onNotice('Copied to clipboard.', 'success');
  } catch {
    onNotice('Could not copy.', 'error');
  }
};
const NOTIF_READ_KEY = 'homelab-notif-read-ids';
const NAV_IDS = new Set(
  ['overview', 'applications', 'docker', 'monitoring', 'maintenance', 'updates', 'domains', 'activity', 'settings'],
);
function HealthDot({ status }: { status?: string }) {
  const cls = healthStatusClass(status);
  if (!status || status === 'unknown') return null;
  return <span className={`health-dot ${cls}`} title={`Health: ${status}`} aria-hidden />;
}
function AppIconDisplay({
  icon,
  size = 34,
  healthStatus,
}: {
  icon?: string;
  size?: number;
  healthStatus?: string;
}) {
  const src = selfhIconUrl(icon);
  return (
    <div className="app-icon-wrap" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" width={size} height={size} className="app-icon-img" loading="lazy" />
      ) : (
        <div className="app-icon" style={{ width: size, height: size }}>
          <AppWindow size={18} />
        </div>
      )}
      <HealthDot status={healthStatus} />
    </div>
  );
}
function ToastStack({
  items,
  onDismiss,
}: {
  items: { id: number; text: string; tone: NoticeTone }[];
  onDismiss: (id: number) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-item ${t.tone}`}>
          <span>{t.text}</span>
          <button type="button" className="icon-btn toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
function FormModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-form" onClick={(e) => e.stopPropagation()}>
        <div className="modal-form-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function PinModal({
  title,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
  busy: boolean;
}) {
  const [pin, setPin] = useState("");
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-icon">
          <LockKeyhole />
        </div>
        <h2>Security verification</h2>
        <p>
          Enter your 4-digit security passcode to authorize <b>{title}</b>.
        </p>
        <input
          autoFocus
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          placeholder="••••"
          className="pin-input"
        />
        <div className="modal-actions">
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={pin.length !== 4 || busy}
            onClick={() => onConfirm(pin)}
          >
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-wrap">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api('/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email, password }),
            });
            await api('/auth/me');
            try {
              sessionStorage.setItem('hc-authed', '1');
            } catch {
              /* private mode */
            }
            onLogin();
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-mark">
          <Server />
        </div>
        <h1>Homelab Central</h1>
        <p>Sign in to your server control center</p>
        <label>
          Email address
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <small>
          Protected by administrator authentication and Cloudflare Access.
        </small>
      </form>
    </main>
  );
}
const slugToPage = (slug: string[] | undefined): string => {
  const seg = slug?.[0];
  if (!seg) return 'overview';
  return NAV_IDS.has(seg) ? seg : 'overview';
};

function DashboardSkeleton() {
  return (
    <div className="shell">
      <aside className="sidebar skeleton-sidebar">
        <div className="skel skel-brand" />
        <div className="skel skel-nav" />
        <div className="skel skel-nav" />
        <div className="skel skel-nav" />
      </aside>
      <main className="main">
        <header className="topbar skel-topbar">
          <div className="skel skel-line w-40" />
          <div className="skel skel-line w-24" />
        </header>
        <div className="content">
          <PageSkeleton />
        </div>
      </main>
    </div>
  );
}
function PageSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="skel skel-line w-48" />
      <div className="skel skel-line w-72" />
      <div className="skel skel-panel" />
      <div className="skel-grid">
        <div className="skel skel-card" />
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
    </div>
  );
}
function HomeDashboard() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [navPending, startNavTransition] = useTransition();
  const slug = params.slug as string[] | undefined;
  const page = slugToPage(slug);
  const setPage = (id: string) => {
    startNavTransition(() => {
      router.push(id === 'overview' ? '/' : `/${encodeURIComponent(id)}`, { scroll: false });
    });
  };
  // Legacy bookmarks: /?view=applications → /applications
  useEffect(() => {
    const legacy = searchParams.get('view');
    if (!legacy || !NAV_IDS.has(legacy)) return;
    router.replace(legacy === 'overview' ? '/' : `/${encodeURIComponent(legacy)}`);
  }, [searchParams, router]);
  useEffect(() => {
    const seg = slug?.[0];
    if (seg && !NAV_IDS.has(seg)) router.replace('/');
  }, [slug, router]);
  const [authed, setAuthed] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem('hc-authed') === '1' ? true : null;
    } catch {
      return null;
    }
  });
  const [summary, setSummary] = useState<Summary>({ status: "Checking" });
  const [apps, setApps] = useState<AppItem[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [modal, setModal] = useState<{
    action: string;
    title: string;
    resourceId?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [updateAlerts, setUpdateAlerts] = useState<any[]>([]);
  const [updateScannedAt, setUpdateScannedAt] = useState<string | null>(null);
  const [systemAlerts, setSystemAlerts] = useState<SystemAlert[]>([]);
  const [readNotifIds, setReadNotifIds] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toastQueue, setToastQueue] = useState<{ id: number; text: string; tone: NoticeTone }[]>([]);
  const NOTIF_DISMISS_KEY = 'homelab-notif-dismissed-scan';
  const pageTitle = nav.find((n) => n.id === page)?.label || 'Overview';
  useEffect(() => {
    document.title =
      page === 'overview' ? 'Homelab Central' : `${pageTitle} · Homelab Central`;
  }, [page, pageTitle]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_READ_KEY);
      if (raw) setReadNotifIds(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    api('/auth/me')
      .then(() => {
        setAuthed(true);
        try {
          sessionStorage.setItem('hc-authed', '1');
        } catch {
          /* private mode */
        }
      })
      .catch(() => {
        setAuthed(false);
        try {
          sessionStorage.removeItem('hc-authed');
        } catch {
          /* private mode */
        }
      });
  }, []);
  const refresh = () => {
    api("/dashboard/summary")
      .then(setSummary)
      .catch(() => setSummary({ status: "Unavailable" }));
    api("/applications")
      .then((d) => setApps(d.items || d || []))
      .catch(() => {});
    api("/docker/containers")
      .then((d) => setContainers(d.items || d || []))
      .catch(() => {});
    api('/activities?limit=8')
      .then((d) => setActivities(d.items || d || []))
      .catch(() => {});
    void loadSystemAlerts();
  };
  useEffect(() => {
    if (!authed) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [authed]);
  const loadSystemAlerts = () =>
    api('/notifications/alerts')
      .then((d) => setSystemAlerts(d.items || []))
      .catch(() => setSystemAlerts([]));
  const applyUpdateAlerts = (d: { items?: any[]; scannedAt?: string | null }) => {
    const items = d.items || [];
    const scannedAt = d.scannedAt || null;
    setUpdateScannedAt(scannedAt);
    let dismissed = '';
    try {
      dismissed = localStorage.getItem(NOTIF_DISMISS_KEY) || '';
    } catch {
      /* private mode */
    }
    if (scannedAt && dismissed === scannedAt) {
      setUpdateAlerts([]);
    } else {
      setUpdateAlerts(items);
    }
    return items;
  };
  const loadUpdateAlerts = () =>
    api('/updates')
      .then((d) => applyUpdateAlerts(d))
      .catch(() => {
        setUpdateAlerts([]);
        return [] as any[];
      });
  const persistReadIds = (ids: string[]) => {
    setReadNotifIds(ids);
    try {
      localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids));
    } catch {
      /* private mode */
    }
  };
  const markUpdateRead = (u: { id?: string; name?: string }) => {
    const key = notifUpdateKey(u);
    persistReadIds([...new Set([...readNotifIds, key])]);
  };
  const markSystemAlertRead = async (id: string) => {
    await api(`/notifications/alerts/${id}/read`, { method: 'POST' }).catch(() => undefined);
    setSystemAlerts((list) =>
      list.map((a) => (a.id === id ? { ...a, read: true } : a)),
    );
  };
  const unreadUpdates = updateAlerts.filter((u) => !readNotifIds.includes(notifUpdateKey(u)));
  const unreadSystem = systemAlerts.filter((a) => !a.read);
  const unreadNotifCount = unreadUpdates.length + unreadSystem.length;
  const clearNotifications = () => {
    try {
      if (updateScannedAt) localStorage.setItem(NOTIF_DISMISS_KEY, updateScannedAt);
      const keys = updateAlerts.map((u) => notifUpdateKey(u));
      persistReadIds([...new Set([...readNotifIds, ...keys])]);
    } catch {
      /* private mode */
    }
    void api('/notifications/alerts/read-all', { method: 'POST' })
      .then(() => loadSystemAlerts())
      .catch(() => undefined);
    setUpdateAlerts([]);
    setNotifOpen(false);
  };
  useEffect(() => {
    if (!authed) return;
    void loadSystemAlerts();
    let cancelled = false;
    void loadUpdateAlerts().then((items) => {
      if (cancelled || !items.length) return;
      try {
        if (sessionStorage.getItem('homelab-notif-auto') === '1') return;
        sessionStorage.setItem('homelab-notif-auto', '1');
      } catch {
        /* private mode */
      }
      setNotifOpen(true);
    });
    const t = setInterval(() => {
      void loadUpdateAlerts();
      void loadSystemAlerts();
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [authed]);
  useEffect(() => {
    if (!notifOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (document.querySelector('.notif-wrap')?.contains(t)) return;
      setNotifOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [notifOpen]);
  const enqueueToast = (text: string, tone: NoticeTone = 'success') => {
    const id = Date.now() + Math.random();
    setToastQueue((q) => [...q, { id, text, tone }]);
    window.setTimeout(() => {
      setToastQueue((q) => q.filter((t) => t.id !== id));
    }, 6000);
  };
  const pushNoticeScoped = (text: string, tone: NoticeTone = 'success') => {
    enqueueToast(text, tone);
  };
  const act = async (pin: string) => {
    if (!modal) return;
    setBusy(true);
    try {
      await api("/operations", {
        method: "POST",
        body: JSON.stringify({
          action: modal.action,
          resourceId: modal.resourceId,
          passcode: pin,
        }),
      });
      pushNoticeScoped('Operation accepted. Check activity logs for progress.', 'success');
      setModal(null);
      refresh();
    } catch (e) {
      pushNoticeScoped((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (authed === null) return <DashboardSkeleton />;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  const title = pageTitle;
  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark small">
            <Server />
          </div>
          <div>
            <b>Homelab Central</b>
            <small>SERVER CONTROL CENTER</small>
          </div>
          <button
            className="icon-btn mobile-close"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => {
                setPage(n.id);
                setMobile(false);
              }}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "domains" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="server-chip">
            <span className="pulse" />
            <div>
              <b>Homelab server</b>
              <small>{summary.status || "Checking status"}</small>
            </div>
          </div>
          <button
            className="nav-item"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => {});
              try {
                sessionStorage.removeItem('hc-authed');
              } catch {
                /* private mode */
              }
              setAuthed(false);
            }}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div>
            <span className="crumb">Workspace / </span>
            <b>{title}</b>
          </div>
          <div className="top-actions">
            <span className="online">
              <i /> {summary.status || "Checking"}
            </span>
            <div className="notif-wrap">
              <button
                type="button"
                className={`icon-btn notif-btn${unreadNotifCount ? ' has-alerts' : ''}`}
                title="Notifications"
                aria-expanded={notifOpen}
                aria-label={
                  unreadNotifCount
                    ? `${unreadNotifCount} unread notifications`
                    : 'Notifications'
                }
                onClick={() => setNotifOpen((o) => !o)}
              >
                <Bell size={17} />
                {unreadNotifCount > 0 && (
                  <span className="notif-badge">{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>
                )}
              </button>
              {notifOpen && (
                <div className="notif-panel" role="dialog" aria-label="Notifications">
                  <div className="notif-panel-head">
                    <b>Notifications</b>
                    <div className="notif-panel-tools">
                      {unreadNotifCount > 0 && (
                        <button type="button" className="text-btn notif-clear" onClick={clearNotifications}>
                          Clear all
                        </button>
                      )}
                      <button type="button" className="icon-btn" onClick={() => setNotifOpen(false)} aria-label="Close">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  {unreadSystem.length > 0 || systemAlerts.some((a) => a.read) ? (
                    <>
                      <p className="notif-panel-sub">System alerts</p>
                      <ul className="notif-list">
                        {systemAlerts.slice(0, 12).map((a) => (
                          <li key={a.id} className={a.read ? 'notif-read' : ''}>
                            <b>{a.type}</b>
                            <small>{a.message}</small>
                            {!a.read && (
                              <button
                                type="button"
                                className="text-btn notif-mark-read"
                                onClick={() => void markSystemAlertRead(a.id)}
                              >
                                Mark read
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {updateAlerts.length ? (
                    <>
                      <p className="notif-panel-sub">
                        {unreadUpdates.length} unread · {updateAlerts.length} Docker update
                        {updateAlerts.length === 1 ? '' : 's'}
                      </p>
                      <ul className="notif-list">
                        {updateAlerts.slice(0, 12).map((u: any) => {
                          const key = notifUpdateKey(u);
                          const isRead = readNotifIds.includes(key);
                          return (
                            <li key={key} className={isRead ? 'notif-read' : ''}>
                              <b>{u.name}</b>
                              <small>
                                {u.currentTag || '—'} → {u.availableTag || '—'}
                              </small>
                              {!isRead && (
                                <button
                                  type="button"
                                  className="text-btn notif-mark-read"
                                  onClick={() => markUpdateRead(u)}
                                >
                                  Mark read
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {updateAlerts.length > 12 && (
                        <p className="muted notif-more">+{updateAlerts.length - 12} more in Updates</p>
                      )}
                      <button
                        type="button"
                        className="btn secondary full notif-go"
                        onClick={() => {
                          setNotifOpen(false);
                          setPage('updates');
                        }}
                      >
                        Open Updates
                      </button>
                    </>
                  ) : (
                    <p className="muted notif-empty">No pending image updates. Scans run from the Updates page.</p>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn" onClick={refresh} title="Refresh">
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className={`content${navPending ? ' content-pending' : ''}`}>
          {navPending ? (
            <PageSkeleton />
          ) : (
          <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">HOMELAB OVERVIEW</div>
              <h1>{title}</h1>
              <p>
                {page === "overview"
                  ? "Monitor and manage your self-hosted infrastructure."
                  : `Manage ${title.toLowerCase()} for your homelab.`}
              </p>
            </div>
            {page === "overview" && (
              <div className="heading-actions">
                <button
                  className="btn secondary"
                  onClick={() => setPage("maintenance")}
                >
                  <Mail size={16} /> Maintenance email
                </button>
                <button
                  className="btn danger"
                  onClick={() =>
                    setModal({
                      action: "host.reboot",
                      title: "reboot the server",
                    })
                  }
                >
                  <RefreshCw size={16} /> Reboot server
                </button>
              </div>
            )}
          </div>
          {page === "overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  icon={Cpu}
                  label="CPU usage"
                  value={summary.cpu == null ? "—" : `${summary.cpu}%`}
                  sub="Host utilization"
                />
                <Stat
                  icon={Monitor}
                  label="Memory"
                  value={summary.memory == null ? "—" : `${summary.memory}%`}
                  sub="RAM utilization"
                />
                <Stat
                  icon={HardDrive}
                  label="Disk usage"
                  value={summary.disk == null ? "—" : `${summary.disk}%`}
                  sub="Root filesystem"
                />
                <Stat
                  icon={Box}
                  label="Containers"
                  value={
                    summary.containers
                      ? `${summary.containers.running}/${summary.containers.total}`
                      : "—"
                  }
                  sub="Running / total"
                />
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Applications</h2>
                      <p>Your self-hosted services</p>
                    </div>
                    <button
                      className="text-btn"
                      onClick={() => setPage("applications")}
                    >
                      View all <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="app-grid">
                    {apps.slice(0, 8).map((a) => (
                      <a
                        className="app-card"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        key={a.id}
                      >
                        <AppIconDisplay icon={a.icon} healthStatus={a.healthStatus} />
                        <div>
                          <b>{a.name}</b>
                          <small>{appSubtitle(a)}</small>
                        </div>
                        <ExternalLink size={14} className="external" />
                      </a>
                    ))}
                    {!apps.length && (
                      <Empty text="No applications configured yet." />
                    )}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Quick actions</h2>
                      <p>Frequently used controls</p>
                    </div>
                  </div>
                  <div className="quick-list">
                    <Quick
                      icon={Mail}
                      title="Send maintenance notice"
                      desc="Notify configured recipients"
                      onClick={() => setPage("maintenance")}
                    />
                    <Quick
                      icon={RefreshCw}
                      title="Restart Docker"
                      desc="Restart the Docker daemon"
                      onClick={() =>
                        setModal({
                          action: "host.docker-restart",
                          title: "restart Docker",
                        })
                      }
                    />
                    <Quick
                      icon={PowerIcon}
                      title="Shut down server"
                      desc="Power off the host"
                      onClick={() =>
                        setModal({
                          action: "host.shutdown",
                          title: "shut down the server",
                        })
                      }
                    />
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Recent activity</h2>
                    <p>Latest administrative operations</p>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => setPage("activity")}
                  >
                    View logs <ChevronRight size={15} />
                  </button>
                </div>
                <ActivityList items={activities} />
              </section>
            </>
          )}
          {page === 'applications' && (
            <ApplicationsPanel apps={apps} onRefresh={refresh} onNotice={pushNoticeScoped} />
          )}
          {page === "docker" && (
            <DockerContainersPanel
              containers={containers}
              onRefresh={refresh}
              onPinAction={(action, resourceId, title) =>
                setModal({ action, resourceId, title })
              }
            />
          )}
          {page === "monitoring" && <ServerMonitoringPanel summary={summary} />}
          {page === 'maintenance' && <Maintenance onNotice={pushNoticeScoped} />}
          {page === 'updates' && (
            <Updates onNotice={pushNoticeScoped} onAlertsRefresh={() => void loadUpdateAlerts()} />
          )}
          {page === 'domains' && <Domains onNotice={pushNoticeScoped} />}
          {page === "activity" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Activity history</h2>
                  <p>Audited administrator actions</p>
                </div>
              </div>
              <ActivityList items={activities} />
            </section>
          )}
          {page === 'settings' && <SettingsPage onNotice={pushNoticeScoped} />}
          </>
          )}
        </div>
      </main>
      <ToastStack
        items={toastQueue}
        onDismiss={(id) => setToastQueue((q) => q.filter((t) => t.id !== id))}
      />
      {modal && (
        <PinModal
          title={modal.title}
          onCancel={() => setModal(null)}
          onConfirm={act}
          busy={busy}
        />
      )}
    </div>
  );
}
function PowerIcon(props: any) {
  return <Server {...props} />;
}
function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{sub || "Live status"}</small>
    </div>
  );
}
function Quick({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: any;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button className="quick-item" onClick={onClick}>
      <span className="quick-icon">
        <Icon size={18} />
      </span>
      <span>
        <b>{title}</b>
        <small>{desc}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <CircleAlert size={20} />
      {text}
    </div>
  );
}
function DataCardRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="data-card-row">
      <span className="data-card-label">{label}</span>
      <span className="data-card-value">{value}</span>
    </div>
  );
}
function DockerContainersPanel({
  containers,
  onRefresh,
  onPinAction,
}: {
  containers: any[];
  onRefresh: () => void;
  onPinAction: (action: string, resourceId: string, title: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Docker containers</h2>
          <p>Live container inventory</p>
        </div>
        <button className="btn secondary" onClick={onRefresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="table-wrap table-mobile-cards">
        <table className="data-table">
          <thead>
            <tr>
              <th>Container</th>
              <th>Image</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b>
                  <small className="block">{c.project || 'Docker'}</small>
                </td>
                <td>{c.image}</td>
                <td>
                  <span className="status-pill">{c.status}</span>
                </td>
                <td className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      onPinAction('container.restart', c.id, `restart ${c.name}`)
                    }
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onPinAction(
                        c.running ? 'container.stop' : 'container.start',
                        c.id,
                        `${c.running ? 'stop' : 'start'} ${c.name}`,
                      )
                    }
                  >
                    {c.running ? 'Stop' : 'Start'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="data-cards">
          {containers.map((c) => (
            <article className="data-card" key={c.id}>
              <div className="data-card-head">
                <b>{c.name}</b>
                <span className="status-pill">{c.status}</span>
              </div>
              <DataCardRow label="Project" value={c.project || 'Docker'} />
              <DataCardRow label="Image" value={c.image || '—'} />
              <div className="data-card-actions">
                <button
                  type="button"
                  className="tile-action"
                  onClick={() =>
                    onPinAction('container.restart', c.id, `restart ${c.name}`)
                  }
                >
                  Restart
                </button>
                <button
                  type="button"
                  className="tile-action"
                  onClick={() =>
                    onPinAction(
                      c.running ? 'container.stop' : 'container.start',
                      c.id,
                      `${c.running ? 'stop' : 'start'} ${c.name}`,
                    )
                  }
                >
                  {c.running ? 'Stop' : 'Start'}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!containers.length && (
          <Empty text="Docker gateway unavailable or no containers found." />
        )}
      </div>
    </section>
  );
}
function MetricSparkline({
  points,
  color = '#6ca7ff',
  height = 72,
}: {
  points: number[];
  color?: string;
  height?: number;
}) {
  const w = 400;
  const vals = points.length ? points : [0];
  const min = Math.min(0, ...vals);
  const max = Math.max(100, ...vals);
  const range = max - min || 1;
  const pad = 6;
  const poly = vals
    .map((v, i) => {
      const x =
        vals.length === 1 ? w / 2 : pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      className="metric-spark"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden
    >
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" points={poly} />
    </svg>
  );
}
function ServerMonitoringPanel({ summary }: { summary: Summary }) {
  const [chartHours, setChartHours] = useState<1 | 6 | 24>(6);
  const [series, setSeries] = useState<Record<string, number[]>>({
    cpu: [],
    memory: [],
    disk: [],
  });
  const mergeSeries = (incoming: Record<string, { t: string; v: number }[]>) => {
    setSeries((prev) => {
      const next = { ...prev };
      for (const key of ['cpu', 'memory', 'disk']) {
        const fromApi = (incoming[key] || []).map((p) => p.v);
        if (fromApi.length) next[key] = fromApi.slice(-500);
        else if (!next[key]?.length) next[key] = [];
      }
      return next;
    });
  };
  useEffect(() => {
    const load = () =>
      api(`/metrics/history?hours=${chartHours}`)
        .then((d) => mergeSeries(d.series || {}))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [chartHours]);
  useEffect(() => {
    setSeries((prev) => {
      const next = { ...prev };
      if (typeof summary.cpu === 'number') {
        next.cpu = [...(prev.cpu || []), summary.cpu].slice(-500);
      }
      if (typeof summary.memory === 'number') {
        next.memory = [...(prev.memory || []), summary.memory].slice(-500);
      }
      if (typeof summary.disk === 'number') {
        next.disk = [...(prev.disk || []), summary.disk].slice(-500);
      }
      return next;
    });
  }, [summary.cpu, summary.memory, summary.disk]);
  const chartHint =
    series.cpu.length < 2
      ? 'Chart fills in as new samples are collected (about every 15 seconds).'
      : `Showing the last ${chartHours} hour${chartHours === 1 ? '' : 's'} of samples.`;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Server metrics</h2>
          <p>Live host metrics · refreshes every 15 seconds</p>
        </div>
        <div className="segmented" role="group" aria-label="Chart time range">
          {([1, 6, 24] as const).map((h) => (
            <button
              key={h}
              type="button"
              className={chartHours === h ? 'active' : ''}
              onClick={() => setChartHours(h)}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>
      <div className="stats-grid">
        <Stat icon={Cpu} label="CPU" value={summary.cpu == null ? '—' : `${summary.cpu}%`} />
        <Stat
          icon={Monitor}
          label="Memory"
          value={summary.memory == null ? '—' : `${summary.memory}%`}
        />
        <Stat icon={HardDrive} label="Disk" value={summary.disk == null ? '—' : `${summary.disk}%`} />
        <Stat icon={Wifi} label="Uptime" value={summary.uptime || '—'} />
      </div>
      <div className="metric-charts">
        <div className="metric-chart-card">
          <div className="metric-chart-label">CPU %</div>
          <MetricSparkline points={series.cpu} color="#6ca7ff" />
        </div>
        <div className="metric-chart-card">
          <div className="metric-chart-label">Memory %</div>
          <MetricSparkline points={series.memory} color="#54c69a" />
        </div>
        <div className="metric-chart-card">
          <div className="metric-chart-label">Disk %</div>
          <MetricSparkline points={series.disk} color="#e9b65b" />
        </div>
      </div>
      <p className="muted">{chartHint}</p>
    </section>
  );
}
function ActivityList({ items }: { items: any[] }) {
  return (
    <div className="activity-list">
      {items.map((a: any) => (
        <div className="activity-row" key={a.id}>
          <span className="activity-icon">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <b>{a.action}</b>
            <small>
              {a.resourceType || "System"} ·{" "}
              {new Date(a.createdAt).toLocaleString()}
            </small>
          </div>
          <span className="status-pill">{a.status}</span>
        </div>
      ))}
      {!items.length && <Empty text="No activity recorded yet." />}
    </div>
  );
}
const emptyAppDraft = (): AppDraft => ({
  name: '',
  url: '',
  category: '',
  description: '',
  sortOrder: 0,
  icon: '',
  healthCheckUrl: '',
});

function AppFormFields({ draft, setDraft }: { draft: AppDraft; setDraft: (d: AppDraft) => void }) {
  return (
    <>
      <div className="form-row">
        <label>
          Name
          <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          Category
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            placeholder="Media, DNS, …"
          />
        </label>
      </div>
      <label>
        URL
        <input required type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
      </label>
      <label>
        Health check URL (optional)
        <input
          type="url"
          placeholder="Defaults to app URL — probed every 5 minutes"
          value={draft.healthCheckUrl}
          onChange={(e) => setDraft({ ...draft, healthCheckUrl: e.target.value })}
        />
      </label>
      <label>
        Icon slug (selfh.st)
        <input
          value={draft.icon}
          onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
          placeholder="traefik, jellyfin, portainer"
        />
        <span className="muted">
          Lowercase name from{' '}
          <a href="https://selfh.st/icons/" target="_blank" rel="noreferrer">
            selfh.st/icons
          </a>
          , or paste a full image URL.
        </span>
      </label>
      {draft.icon ? (
        <div className="icon-preview">
          <AppIconDisplay icon={draft.icon} size={40} />
          <span className="muted">Preview</span>
        </div>
      ) : null}
      <label>
        Description (optional)
        <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <label>
        Sort order
        <input
          type="number"
          min={0}
          value={draft.sortOrder}
          onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
        />
      </label>
    </>
  );
}

function ApplicationsPanel({
  apps,
  onRefresh,
  onNotice,
}: {
  apps: AppItem[];
  onRefresh: () => void;
  onNotice: (s: string, tone?: NoticeTone) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editApp, setEditApp] = useState<AppItem | null>(null);
  const [draft, setDraft] = useState(emptyAppDraft());
  const openEdit = (a: AppItem) => {
    setEditApp(a);
    setDraft({
      name: a.name,
      url: a.url,
      category: a.category || '',
      description: a.description || '',
      sortOrder: a.sortOrder ?? 0,
      icon: a.icon || '',
      healthCheckUrl: a.healthCheckUrl || '',
    });
  };
  const savePayload = (d: AppDraft) => ({
    name: d.name.trim(),
    url: d.url.trim(),
    category: d.category.trim() || null,
    description: d.description.trim() || null,
    icon: d.icon.trim() || null,
    healthCheckUrl: d.healthCheckUrl.trim() || null,
    sortOrder: Number(d.sortOrder) || 0,
    enabled: true,
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Application launcher</h2>
          <p>Open and monitor registered services</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              try {
                await api('/applications/health-check', { method: 'POST' });
                onRefresh();
                onNotice('Health checks completed.', 'success');
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <RefreshCw size={15} /> Check health
          </button>
          <button type="button" className="btn primary" onClick={() => { setDraft(emptyAppDraft()); setShowAdd(true); }}>
            Add application
          </button>
        </div>
      </div>
      <div className="app-grid large">
        {apps.map((a) => (
          <article className="app-tile" key={a.id}>
            <a className="app-card" href={a.url} target="_blank" rel="noreferrer">
              <AppIconDisplay icon={a.icon} healthStatus={a.healthStatus} />
              <div className="app-card-body">
                <b>{a.name}</b>
                <small>{appSubtitle(a)}</small>
              </div>
              <ExternalLink size={14} className="external" aria-hidden />
            </a>
            <div className="app-tile-actions" aria-label={`Actions for ${a.name}`}>
              <button type="button" className="tile-action" onClick={() => openEdit(a)}>
                Edit
              </button>
              <button
                type="button"
                className="tile-action danger-text"
                onClick={async () => {
                  if (!confirm(`Remove ${a.name}?`)) return;
                  try {
                    await api(`/applications/${a.id}`, { method: 'DELETE' });
                    onRefresh();
                    onNotice('Application removed.', 'success');
                  } catch (x) {
                    onNotice((x as Error).message, 'error');
                  }
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
        {!apps.length && <Empty text="No applications yet — use Add application." />}
      </div>
      {showAdd && (
        <FormModal title="Add application" onClose={() => setShowAdd(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/applications', { method: 'POST', body: JSON.stringify(savePayload(draft)) });
                setDraft(emptyAppDraft());
                setShowAdd(false);
                onRefresh();
                onNotice('Application added.', 'success');
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <AppFormFields draft={draft} setDraft={setDraft} />
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save
              </button>
            </div>
          </form>
        </FormModal>
      )}
      {editApp && (
        <FormModal title={`Edit ${editApp.name}`} onClose={() => setEditApp(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/applications/${editApp.id}`, {
                  method: 'PUT',
                  body: JSON.stringify(savePayload(draft)),
                });
                setEditApp(null);
                onRefresh();
                onNotice('Application updated.', 'success');
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <AppFormFields draft={draft} setDraft={setDraft} />
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setEditApp(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save changes
              </button>
            </div>
          </form>
        </FormModal>
      )}
    </section>
  );
}
const emptyMaintenanceForm = () => ({
  title: 'Scheduled server maintenance',
  description: '',
  startAt: '',
  endAt: '',
  subject: 'Scheduled maintenance – Homelab services',
  recipientIds: [] as string[],
});

function Maintenance({
  onNotice,
}: {
  onNotice: (s: string, tone?: NoticeTone) => void;
}) {
  const [recipients, setRecipients] = useState<any[]>([]);
  const [showRecipient, setShowRecipient] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [newRecipient, setNewRecipient] = useState({ name: '', email: '' });
  const [form, setForm] = useState(emptyMaintenanceForm());
  const [mailLog, setMailLog] = useState<any[]>([]);
  const loadMailLog = () =>
    api('/notifications/history')
      .then((d) => setMailLog((d.items || []).slice(0, 8)))
      .catch(() => {});
  const loadRecipients = () =>
    api('/notifications/recipients')
      .then((d) => setRecipients(d.items || []))
      .catch(() => onNotice('Could not load recipients.', 'error'));
  useEffect(() => {
    void loadRecipients();
    void loadMailLog();
  }, []);
  const toggleRecipient = (id: string) => {
    setForm((prev) => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(id)
        ? prev.recipientIds.filter((x) => x !== id)
        : [...prev.recipientIds, id],
    }));
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Maintenance notifications</h2>
          <p>Manage recipients and send SMTP announcements</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn secondary" onClick={() => setShowRecipient(true)}>
            Add recipient
          </button>
          <button type="button" className="btn primary" onClick={() => setShowSend(true)}>
            <Mail size={16} /> Send mail now
          </button>
        </div>
      </div>
      {!recipients.length ? (
        <Empty text="No recipients yet — add one before sending maintenance mail." />
      ) : (
        <ul className="recipient-list">
          {recipients.map((r) => (
            <li key={r.id}>
              <b>{r.name}</b> — {r.email}
            </li>
          ))}
        </ul>
      )}
      {!!mailLog.length && (
        <section className="panel nested-panel">
          <h3 className="subhead">Recent email deliveries</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {mailLog.map((m) => (
                  <tr key={m.id}>
                    <td>{m.recipientEmail}</td>
                    <td>{m.subject}</td>
                    <td className={m.status === 'failed' ? 'cert-bad' : ''}>{m.status}</td>
                    <td>{new Date(m.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {showRecipient && (
        <FormModal title="Add recipient" onClose={() => setShowRecipient(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/notifications/recipients', {
                  method: 'POST',
                  body: JSON.stringify(newRecipient),
                });
                setNewRecipient({ name: '', email: '' });
                setShowRecipient(false);
                await loadRecipients();
                onNotice('Recipient added.', 'success');
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <div className="form-row">
              <label>
                Name
                <input
                  required
                  value={newRecipient.name}
                  onChange={(e) => setNewRecipient({ ...newRecipient, name: e.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={newRecipient.email}
                  onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowRecipient(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save
              </button>
            </div>
          </form>
        </FormModal>
      )}
      {showSend && (
        <FormModal title="Send maintenance notification" onClose={() => setShowSend(false)}>
          <p className="muted">Requires SMTP settings in <code>.env</code>.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.recipientIds.length) {
                onNotice('Select at least one recipient.', 'warning');
                return;
              }
              const payload = {
                title: form.title.trim(),
                subject: form.subject.trim(),
                description: form.description,
                startAt: form.startAt || null,
                endAt: form.endAt || null,
                recipientIds: form.recipientIds,
              };
              try {
                const result = await api('/notifications/send', {
                  method: 'POST',
                  body: JSON.stringify(payload),
                });
                setForm(emptyMaintenanceForm());
                setShowSend(false);
                const tone =
                  result.failed > 0 ? ('warning' as NoticeTone) : ('success' as NoticeTone);
                onNotice(result.message || 'Email sent.', tone);
                void loadMailLog();
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <label>
              Subject
              <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </label>
            <label>
              Maintenance title
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Start time
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                />
              </label>
              <label>
                Expected end
                <input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                />
              </label>
            </div>
            <fieldset className="recipient-pick">
              <legend>Recipients</legend>
              {recipients.map((r) => (
                <label key={r.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={form.recipientIds.includes(r.id)}
                    onChange={() => toggleRecipient(r.id)}
                  />
                  {r.name} — {r.email}
                </label>
              ))}
              {!recipients.length && <p className="muted">Add a recipient first.</p>}
            </fieldset>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowSend(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                <Mail size={16} /> Send now
              </button>
            </div>
          </form>
        </FormModal>
      )}
    </section>
  );
}
function Updates({
  onNotice,
  onAlertsRefresh,
}: {
  onNotice: (s: string, tone?: NoticeTone) => void;
  onAlertsRefresh?: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [hint, setHint] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [wudUrl, setWudUrl] = useState<string | null>(null);
  const applyUpdatePayload = (d: any) => {
    setItems(d.items || []);
    setConfigured(d.configured !== false);
    setScannedAt(d.scannedAt || null);
    setWudUrl(d.wudUrl || null);
    if (d.configured === false && d.message) setHint(d.message);
  };
  const renderUpdateActions = (u: any) => (
    <div className="data-card-actions update-actions">
      {u.pullCommand && (
        <button
          type="button"
          className="tile-action"
          onClick={() => void copyText(u.pullCommand, onNotice)}
        >
          Copy pull
        </button>
      )}
      {(u.wudLink || wudUrl) && (
        <a
          className="tile-action"
          href={u.wudLink || wudUrl || '#'}
          target="_blank"
          rel="noreferrer"
        >
          Open WUD containers
        </a>
      )}
    </div>
  );
  useEffect(() => {
    api('/updates')
      .then((d) => {
        applyUpdatePayload(d);
        onAlertsRefresh?.();
      })
      .catch(() => onNotice('Could not load updates.', 'error'));
  }, []);
  const scan = async () => {
    try {
      const d = await api('/updates/scan', { method: 'POST' });
      applyUpdatePayload(d);
      onAlertsRefresh?.();
      onNotice(d.message || 'Update scan completed.', 'success');
    } catch (e) {
      onNotice((e as Error).message, 'error');
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Docker updates</h2>
          <p>
            Synced from What&apos;s Up Docker
            {scannedAt ? ` · last scan ${new Date(scannedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void scan()}>
          <RefreshCw size={15} /> Scan images
        </button>
      </div>
      {hint && configured === false && <p className="muted">{hint}</p>}
      {items.length ? (
        <div className="table-wrap table-mobile-cards">
          <table className="data-table">
            <thead>
              <tr>
                <th>Container</th>
                <th>Image</th>
                <th>Running</th>
                <th>Available</th>
                <th>Change</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u: any) => (
                <tr key={u.id || u.name}>
                  <td>
                    <b>{u.name}</b>
                  </td>
                  <td>{u.image || '—'}</td>
                  <td>{u.currentTag || '—'}</td>
                  <td>{u.availableTag || '—'}</td>
                  <td>
                    <span className="status-pill">{u.updateKind || 'update'}</span>
                  </td>
                  <td className="actions">
                    {u.pullCommand && (
                      <button type="button" onClick={() => void copyText(u.pullCommand, onNotice)}>
                        Copy pull
                      </button>
                    )}
                    {(u.wudLink || wudUrl) && (
                      <a
                        className="inline-link"
                        href={u.wudLink || wudUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WUD
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="data-cards">
            {items.map((u: any) => (
              <article className="data-card" key={u.id || u.name}>
                <div className="data-card-head">
                  <b>{u.name}</b>
                  <span className="status-pill">{u.updateKind || 'update'}</span>
                </div>
                <DataCardRow label="Image" value={u.image || '—'} />
                <DataCardRow label="Running" value={u.currentTag || '—'} />
                <DataCardRow label="Available" value={u.availableTag || '—'} />
                {renderUpdateActions(u)}
              </article>
            ))}
          </div>
        </div>
      ) : (
        <Empty text="Run scan to import updates from What's Up Docker (same data as the WUD dashboard)." />
      )}
    </section>
  );
}
function Domains({ onNotice }: { onNotice: (s: string, tone?: NoticeTone) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ hostname: '', checkUrl: '' });
  const load = () =>
    api('/domains')
      .then((d) => setItems(d.items || []))
      .catch(() => onNotice('Could not load domains.', 'error'));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Domains & SSL</h2>
            <p>Run a check to probe HTTP status and read the certificate expiry from the server</p>
          </div>
          <div className="heading-actions">
            <button type="button" className="btn secondary" onClick={() => setShowAdd(true)}>
              Add domain
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!items.length}
              onClick={async () => {
                try {
                  await api('/domains/check-all', { method: 'POST' });
                  await load();
                  onNotice('SSL checks completed.', 'success');
                } catch (x) {
                  onNotice((x as Error).message, 'error');
                }
              }}
            >
              <RefreshCw size={15} /> Run SSL checks
            </button>
          </div>
        </div>
        <div className="table-wrap table-mobile-cards">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>HTTP</th>
                <th>Certificate expiry</th>
                <th>Issuer</th>
                <th>Last checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const expiry = d.lastCheck?.certExpiry
                  ? new Date(d.lastCheck.certExpiry)
                  : null;
                const daysLeft = expiry
                  ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)
                  : null;
                const expiryClass =
                  daysLeft != null && daysLeft < 30
                    ? 'cert-warn'
                    : daysLeft != null && daysLeft < 0
                      ? 'cert-bad'
                      : '';
                const expiryLabel = expiry
                  ? `${expiry.toLocaleDateString()}${daysLeft != null ? ` (${daysLeft}d)` : ''}`
                  : '—';
                return (
                  <tr key={d.id}>
                    <td>{d.hostname}</td>
                    <td>{d.lastCheck?.httpStatus ?? '—'}</td>
                    <td className={expiryClass}>{expiryLabel}</td>
                    <td>{d.lastCheck?.certIssuer || '—'}</td>
                    <td>
                      {d.lastCheck?.checkedAt
                        ? new Date(d.lastCheck.checkedAt).toLocaleString()
                        : 'Never'}
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api(`/domains/${d.id}/check`, { method: 'POST' });
                            await load();
                            onNotice(`Checked ${d.hostname}.`, 'success');
                          } catch (x) {
                            onNotice((x as Error).message, 'error');
                          }
                        }}
                      >
                        Check
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="data-cards">
            {items.map((d) => {
              const expiry = d.lastCheck?.certExpiry
                ? new Date(d.lastCheck.certExpiry)
                : null;
              const daysLeft = expiry
                ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)
                : null;
              const expiryClass =
                daysLeft != null && daysLeft < 30
                  ? 'cert-warn'
                  : daysLeft != null && daysLeft < 0
                    ? 'cert-bad'
                    : '';
              const expiryLabel = expiry
                ? `${expiry.toLocaleDateString()}${daysLeft != null ? ` (${daysLeft}d)` : ''}`
                : '—';
              return (
                <article className="data-card" key={d.id}>
                  <div className="data-card-head">
                    <b>{d.hostname}</b>
                    <span className="status-pill">{d.lastCheck?.httpStatus ?? '—'}</span>
                  </div>
                  <DataCardRow
                    label="Certificate expiry"
                    value={<span className={expiryClass}>{expiryLabel}</span>}
                  />
                  <DataCardRow label="Issuer" value={d.lastCheck?.certIssuer || '—'} />
                  <DataCardRow
                    label="Last checked"
                    value={
                      d.lastCheck?.checkedAt
                        ? new Date(d.lastCheck.checkedAt).toLocaleString()
                        : 'Never'
                    }
                  />
                  <div className="data-card-actions">
                    <button
                      type="button"
                      className="tile-action"
                      onClick={async () => {
                        try {
                          await api(`/domains/${d.id}/check`, { method: 'POST' });
                          await load();
                          onNotice(`Checked ${d.hostname}.`, 'success');
                        } catch (x) {
                          onNotice((x as Error).message, 'error');
                        }
                      }}
                    >
                      Check SSL
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!items.length && <Empty text="No monitored domains yet — use Add domain." />}
        </div>
      </section>
      {showAdd && (
        <FormModal title="Add domain" onClose={() => setShowAdd(false)}>
          <p className="muted">Prefer HTTPS check URLs so certificate expiry can be read from TLS.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/domains', {
                  method: 'POST',
                  body: JSON.stringify({
                    hostname: draft.hostname.trim(),
                    checkUrl: draft.checkUrl.trim() || `https://${draft.hostname.trim()}`,
                    enabled: true,
                  }),
                });
                setDraft({ hostname: '', checkUrl: '' });
                setShowAdd(false);
                await load();
                onNotice('Domain added.', 'success');
              } catch (x) {
                onNotice((x as Error).message, 'error');
              }
            }}
          >
            <label>
              Hostname
              <input
                required
                placeholder="central.albyn.site"
                value={draft.hostname}
                onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
              />
            </label>
            <label>
              Check URL (optional)
              <input
                type="url"
                placeholder="https://central.albyn.site"
                value={draft.checkUrl}
                onChange={(e) => setDraft({ ...draft, checkUrl: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save
              </button>
            </div>
          </form>
        </FormModal>
      )}
    </>
  );
}
function SettingsPage({ onNotice }: { onNotice: (s: string, tone?: NoticeTone) => void }) {
  const [pin, setPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [alerts, setAlerts] = useState({
    cpuThreshold: 90,
    diskThreshold: 90,
    emailEnabled: false,
    inAppEnabled: true,
    cooldownMinutes: 60,
  });
  useEffect(() => {
    api('/settings/alerts')
      .then((d) => setAlerts((a) => ({ ...a, ...d })))
      .catch(() => undefined);
  }, []);
  return (
  <>
    <section className="panel form-panel">
      <h2>Metric alerts</h2>
      <p>Get notified when CPU or disk crosses a threshold (checked on each metrics sample).</p>
      <form
        className="alerts-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const saved = await api('/settings/alerts', { method: 'PUT', body: JSON.stringify(alerts) });
            setAlerts((a) => ({ ...a, ...saved }));
            onNotice('Alert settings saved.', 'success');
          } catch (x) {
            onNotice((x as Error).message, 'error');
          }
        }}
      >
        <div className="form-row">
          <label>
            CPU threshold %
            <input
              type="number"
              min={1}
              max={100}
              value={alerts.cpuThreshold}
              onChange={(e) => setAlerts({ ...alerts, cpuThreshold: Number(e.target.value) })}
            />
          </label>
          <label>
            Disk threshold %
            <input
              type="number"
              min={1}
              max={100}
              value={alerts.diskThreshold}
              onChange={(e) => setAlerts({ ...alerts, diskThreshold: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Alert cooldown (minutes)
          <input
            type="number"
            min={5}
            max={1440}
            value={alerts.cooldownMinutes}
            onChange={(e) => setAlerts({ ...alerts, cooldownMinutes: Number(e.target.value) })}
          />
        </label>
        <label className="alert-toggle">
          <input
            type="checkbox"
            checked={alerts.inAppEnabled}
            onChange={(e) => setAlerts({ ...alerts, inAppEnabled: e.target.checked })}
          />
          <span>Show in-app notifications (bell icon)</span>
        </label>
        <label className="alert-toggle">
          <input
            type="checkbox"
            checked={alerts.emailEnabled}
            onChange={(e) => setAlerts({ ...alerts, emailEnabled: e.target.checked })}
          />
          <span>Email all active maintenance recipients when SMTP is configured</span>
        </label>
        <button className="btn primary" type="submit">
          Save alert settings
        </button>
      </form>
    </section>
    <section className="panel form-panel">
      <h2>Security settings</h2>
      <p>
        Configure the separate four-digit passcode used for critical actions.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/security/passcode/setup', {
              method: 'POST',
              body: JSON.stringify({ pin, currentPin: oldPin || undefined }),
            });
            setPin('');
            setOldPin('');
            onNotice('Security passcode updated.', 'success');
          } catch (x) {
            onNotice((x as Error).message, 'error');
          }
        }}
      >
        <label>
          Current PIN (required when changing an existing PIN)
          <input
            inputMode="numeric"
            type="password"
            maxLength={4}
            value={oldPin}
            onChange={(e) =>
              setOldPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </label>
        <label>
          New 4-digit PIN
          <input
            required
            inputMode="numeric"
            type="password"
            minLength={4}
            maxLength={4}
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </label>
        <button className="btn primary" disabled={pin.length !== 4}>
          Save passcode
        </button>
      </form>
    </section>
  </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <HomeDashboard />
    </Suspense>
  );
}
