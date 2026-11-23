'use client';
import { useEffect, useState, Suspense, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { selfhIconUrl } from '@/lib/selfhIcon';
import {
  Activity,
  AppWindow,
  Archive,
  Bell,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cloud,
  Cpu,
  Database,
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
};
type NoticeTone = 'success' | 'error' | 'warning';
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: AppWindow },
  { id: "docker", label: "Docker", icon: Box },
  { id: "monitoring", label: "Server monitoring", icon: Activity },
  { id: "maintenance", label: "Maintenance", icon: Mail },
  { id: "backups", label: "Backups", icon: Archive },
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
const NAV_IDS = new Set(
  ['overview', 'applications', 'docker', 'monitoring', 'maintenance', 'backups', 'updates', 'domains', 'activity', 'settings'],
);
function AppIconDisplay({ icon, size = 34 }: { icon?: string; size?: number }) {
  const src = selfhIconUrl(icon);
  if (src) {
    return <img src={src} alt="" width={size} height={size} className="app-icon-img" loading="lazy" />;
  }
  return (
    <div className="app-icon" style={{ width: size, height: size }}>
      <AppWindow size={18} />
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
function HomeDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view') || 'overview';
  const page = NAV_IDS.has(viewParam) ? viewParam : 'overview';
  const setPage = (id: string) => {
    router.push(id === 'overview' ? '/' : `/?view=${encodeURIComponent(id)}`, { scroll: false });
  };
  const [authed, setAuthed] = useState<boolean | null>(null);
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
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('success');
  const pushNotice = (text: string, tone: NoticeTone = 'success') => {
    setNotice(text);
    setNoticeTone(tone);
  };
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    api("/auth/me")
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
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
    api("/activities?limit=8")
      .then((d) => setActivities(d.items || d || []))
      .catch(() => {});
  };
  useEffect(() => {
    if (!authed) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [authed]);
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
      pushNotice('Operation accepted. Check activity logs for progress.', 'success');
      setModal(null);
      refresh();
    } catch (e) {
      pushNotice((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (authed === null)
    return <div className="loading">Loading Homelab Central…</div>;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  const title = nav.find((n) => n.id === page)?.label || "Overview";
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
              await api("/auth/logout", { method: "POST" }).catch(() => {});
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
            <button className="icon-btn" onClick={refresh} title="Refresh">
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="content">
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
          {notice && (
            <div
              className={`notice ${noticeTone}`}
              onClick={() => setNotice('')}
              role="status"
            >
              {notice}
              <button type="button" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}
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
                        <AppIconDisplay icon={a.icon} />
                        <div>
                          <b>{a.name}</b>
                          <small>{a.category || "Application"}</small>
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
                      icon={Database}
                      title="Create backup"
                      desc="Start a manual backup"
                      onClick={() => setPage("backups")}
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
            <ApplicationsPanel apps={apps} onRefresh={refresh} onNotice={pushNotice} />
          )}
          {page === "docker" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Docker containers</h2>
                  <p>Live container inventory</p>
                </div>
                <button className="btn secondary" onClick={refresh}>
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              <div className="table-wrap">
                <table>
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
                          <small className="block">
                            {c.project || "Docker"}
                          </small>
                        </td>
                        <td>{c.image}</td>
                        <td>
                          <span className="status-pill">{c.status}</span>
                        </td>
                        <td className="actions">
                          <button
                            onClick={() =>
                              setModal({
                                action: "container.restart",
                                resourceId: c.id,
                                title: `restart ${c.name}`,
                              })
                            }
                          >
                            Restart
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                action: c.running
                                  ? "container.stop"
                                  : "container.start",
                                resourceId: c.id,
                                title: `${c.running ? "stop" : "start"} ${c.name}`,
                              })
                            }
                          >
                            {c.running ? "Stop" : "Start"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!containers.length && (
                  <Empty text="Docker gateway unavailable or no containers found." />
                )}
              </div>
            </section>
          )}
          {page === "monitoring" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Server metrics</h2>
                  <p>Live host metrics · refreshes every 15 seconds</p>
                </div>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={Cpu}
                  label="CPU"
                  value={summary.cpu == null ? "—" : `${summary.cpu}%`}
                />
                <Stat
                  icon={Monitor}
                  label="Memory"
                  value={summary.memory == null ? "—" : `${summary.memory}%`}
                />
                <Stat
                  icon={HardDrive}
                  label="Disk"
                  value={summary.disk == null ? "—" : `${summary.disk}%`}
                />
                <Stat
                  icon={Wifi}
                  label="Uptime"
                  value={summary.uptime || "—"}
                />
              </div>
              <p className="muted">
                Historical charts become available after the metrics collector
                has accumulated samples.
              </p>
            </section>
          )}
          {page === 'maintenance' && <Maintenance onNotice={pushNotice} />}
          {page === 'backups' && <Backups onNotice={pushNotice} />}
          {page === 'updates' && <Updates onNotice={pushNotice} />}
          {page === 'domains' && <Domains onNotice={pushNotice} />}
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
          {page === 'settings' && <SettingsPage onNotice={pushNotice} />}
        </div>
      </main>
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
    });
  };
  const savePayload = (d: AppDraft) => ({
    name: d.name.trim(),
    url: d.url.trim(),
    category: d.category.trim() || null,
    description: d.description.trim() || null,
    icon: d.icon.trim() || null,
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
        <button type="button" className="btn primary" onClick={() => { setDraft(emptyAppDraft()); setShowAdd(true); }}>
          Add application
        </button>
      </div>
      <div className="app-grid large">
        {apps.map((a) => (
          <div className="app-tile" key={a.id}>
            <a className="app-card" href={a.url} target="_blank" rel="noreferrer">
              <AppIconDisplay icon={a.icon} />
              <div>
                <b>{a.name}</b>
                <small>{appSubtitle(a)}</small>
              </div>
              <ExternalLink size={14} className="external" />
            </a>
            <div className="app-tile-actions">
              <button type="button" onClick={() => openEdit(a)}>
                Edit
              </button>
              <button
                type="button"
                className="danger-text"
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
          </div>
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
function Backups({ onNotice }: { onNotice: (s: string, tone?: NoticeTone) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const load = () =>
    api("/backups")
      .then((d) => setItems(d.items || []))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Backup management</h2>
          <p>Create and verify configured backups</p>
        </div>
        <button
          className="btn primary"
          onClick={async () => {
            try {
              await api("/backups", {
                method: "POST",
                body: JSON.stringify({ type: "config" }),
              });
              onNotice('Backup job queued.', 'success');
              load();
            } catch (e) {
              onNotice((e as Error).message, 'error');
            }
          }}
        >
          Create backup
        </button>
      </div>
      <ActivityList
        items={items.map((i) => ({
          ...i,
          action: i.name,
          resourceType: i.backupType,
        }))}
      />
    </section>
  );
}
function Updates({ onNotice }: { onNotice: (s: string, tone?: NoticeTone) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [hint, setHint] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const applyUpdatePayload = (d: any) => {
    setItems(d.items || []);
    setConfigured(d.configured !== false);
    setScannedAt(d.scannedAt || null);
    if (d.configured === false && d.message) setHint(d.message);
  };
  useEffect(() => {
    api('/updates')
      .then(applyUpdatePayload)
      .catch(() => onNotice('Could not load updates.', 'error'));
  }, []);
  const scan = async () => {
    try {
      const d = await api('/updates/scan', { method: 'POST' });
      applyUpdatePayload(d);
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Container</th>
                <th>Image</th>
                <th>Running</th>
                <th>Available</th>
                <th>Change</th>
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
                </tr>
              ))}
            </tbody>
          </table>
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
        <div className="table-wrap">
          <table>
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
                return (
                  <tr key={d.id}>
                    <td>{d.hostname}</td>
                    <td>{d.lastCheck?.httpStatus ?? '—'}</td>
                    <td className={expiryClass}>
                      {expiry
                        ? `${expiry.toLocaleDateString()}${daysLeft != null ? ` (${daysLeft}d)` : ''}`
                        : '—'}
                    </td>
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
  const [pin, setPin] = useState("");
  const [oldPin, setOldPin] = useState("");
  return (
    <section className="panel form-panel">
      <h2>Security settings</h2>
      <p>
        Configure the separate four-digit passcode used for critical actions.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/security/passcode/setup", {
              method: "POST",
              body: JSON.stringify({ pin, currentPin: oldPin || undefined }),
            });
            setPin("");
            setOldPin("");
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
              setOldPin(e.target.value.replace(/\D/g, "").slice(0, 4))
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
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
          />
        </label>
        <button className="btn primary" disabled={pin.length !== 4}>
          Save passcode
        </button>
      </form>
    </section>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="loading">Loading Homelab Central…</div>}>
      <HomeDashboard />
    </Suspense>
  );
}
