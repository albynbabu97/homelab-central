"use client";
import { useEffect, useState } from "react";
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
  healthStatus?: string;
  icon?: string;
};
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
            await api("/auth/login", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            });
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
export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState("overview");
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
  const [notice, setNotice] = useState("");
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
      setNotice("Operation accepted. Check activity logs for progress.");
      setModal(null);
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
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
            <div className="notice" onClick={() => setNotice("")}>
              {notice}
              <button>
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
                        <div className="app-icon">
                          <AppWindow />
                        </div>
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
          {page === "applications" && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Application launcher</h2>
                  <p>Open and monitor registered services</p>
                </div>
              </div>
              <div className="app-grid large">
                {apps.map((a) => (
                  <a
                    className="app-card"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    key={a.id}
                  >
                    <div className="app-icon">
                      <AppWindow />
                    </div>
                    <div>
                      <b>{a.name}</b>
                      <small>
                        {a.category || "Application"} ·{" "}
                        {a.healthStatus || "Health unknown"}
                      </small>
                    </div>
                    <ExternalLink size={14} className="external" />
                  </a>
                ))}
                {!apps.length && (
                  <Empty text="Add application links through the Applications API. UI management is planned in the next iteration." />
                )}
              </div>
            </section>
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
          {page === "maintenance" && <Maintenance onNotice={setNotice} />}
          {page === "backups" && <Backups onNotice={setNotice} />}
          {page === "updates" && <Updates onNotice={setNotice} />}
          {page === "domains" && <Domains />}
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
          {page === "settings" && <SettingsPage onNotice={setNotice} />}
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
function Maintenance({ onNotice }: { onNotice: (s: string) => void }) {
  const [recipients, setRecipients] = useState<any[]>([]);
  const [form, setForm] = useState({
    title: "Scheduled server maintenance",
    description: "",
    startAt: "",
    endAt: "",
    subject: "Scheduled maintenance – Homelab services",
    recipientIds: [] as string[],
  });
  useEffect(() => {
    api("/notifications/recipients")
      .then((d) => setRecipients(d.items || []))
      .catch(() => {});
  }, []);
  return (
    <section className="panel form-panel">
      <h2>Send maintenance notification</h2>
      <p>Compose and send an announcement to configured recipients.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/notifications/send", {
              method: "POST",
              body: JSON.stringify(form),
            });
            onNotice("Maintenance notification queued.");
          } catch (x) {
            onNotice((x as Error).message);
          }
        }}
      >
        <label>
          Subject
          <input
            required
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </label>
        <label>
          Maintenance title
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
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
        <label>
          Recipients
          <select
            multiple
            value={form.recipientIds}
            onChange={(e) =>
              setForm({
                ...form,
                recipientIds: Array.from(
                  e.target.selectedOptions,
                  (o) => o.value,
                ),
              })
            }
          >
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.email}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">Queue notification</button>
      </form>
    </section>
  );
}
function Backups({ onNotice }: { onNotice: (s: string) => void }) {
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
              onNotice("Backup job queued.");
              load();
            } catch (e) {
              onNotice((e as Error).message);
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
function Updates({ onNotice }: { onNotice: (s: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Docker updates</h2>
          <p>Review image updates before applying them</p>
        </div>
        <button
          className="btn secondary"
          onClick={async () => {
            try {
              const d = await api("/updates/scan", { method: "POST" });
              setItems(d.items || []);
              onNotice("Update scan completed.");
            } catch (e) {
              onNotice((e as Error).message);
            }
          }}
        >
          Scan images
        </button>
      </div>
      {items.length ? (
        <pre className="json-view">{JSON.stringify(items, null, 2)}</pre>
      ) : (
        <Empty text="Run a scan to check configured image updates." />
      )}
    </section>
  );
}
function Domains() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api("/domains")
      .then((d) => setItems(d.items || []))
      .catch(() => {});
  }, []);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Domains & SSL</h2>
          <p>Availability and certificate monitoring</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hostname</th>
              <th>HTTP</th>
              <th>Certificate expiry</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.hostname}</td>
                <td>{d.lastCheck?.httpStatus || "—"}</td>
                <td>
                  {d.lastCheck?.certificateExpiry
                    ? new Date(
                        d.lastCheck.certificateExpiry,
                      ).toLocaleDateString()
                    : "—"}
                </td>
                <td>
                  {d.lastCheck?.checkedAt
                    ? new Date(d.lastCheck.checkedAt).toLocaleString()
                    : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="No monitored domains configured." />}
      </div>
    </section>
  );
}
function SettingsPage({ onNotice }: { onNotice: (s: string) => void }) {
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
            onNotice("Security passcode updated.");
          } catch (x) {
            onNotice((x as Error).message);
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
