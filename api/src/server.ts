import 'dotenv/config';
import { randomUUID } from 'crypto';
import tls from 'tls';
import express, { Request, Response, NextFunction } from 'express';
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import session from "express-session";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
const app = express(),
  db = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://redis:6379",
});
redisClient.connect().catch((e) => console.error("Redis connection failed", e));
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
// Production should use a persistent Redis-backed session store. MemoryStore is intentionally not suitable for multi-instance production.
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    name: 'hc.sid',
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many passcode attempts. Try again later." },
});
type Authed = Request & { userId?: string };
const auth = (req: Authed, res: Response, next: NextFunction) => {
  if (!req.session || !(req.session as any).userId)
    return res.status(401).json({ error: "Authentication required" });
  req.userId = (req.session as any).userId;
  next();
};
const audit = async (
  req: Authed,
  action: string,
  type: string | null,
  id: string | null,
  status: string,
  details: any = {},
) =>
  db.activityLog
    .create({
      data: {
        userId: req.userId ?? null,
        action,
        resourceType: type,
        resourceId: id,
        status,
        details,
        ipAddress: req.ip || null,
      },
    })
    .catch(() => null);
const ok = (res: Response, data: any, status = 200) =>
  res
    .status(status)
    .json({
      success: true,
      data: JSON.parse(
        JSON.stringify(data, (_k, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ),
    });
const fail = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });
// Express may type :id params as string | string[]; Prisma and audit expect a single string.
const routeParam = (v: string | string[]) => (Array.isArray(v) ? v[0] : v);
// TLS peer certificate DN fields may be string | string[] in Node types.
const dnValue = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;

const getTlsCertMeta = (host: string, port: number) =>
  new Promise<{ validTo: Date; issuer: string }>((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) return reject(new Error('No certificate returned'));
        resolve({
          validTo: new Date(cert.valid_to),
          issuer:
            dnValue(cert.issuer?.O) ||
            dnValue(cert.issuer?.CN) ||
            'unknown',
        });
      },
    );
    socket.setTimeout(12_000, () => {
      socket.destroy();
      reject(new Error('TLS handshake timed out'));
    });
    socket.on('error', reject);
  });

const probeDomain = async (hostname: string, checkUrl?: string | null) => {
  const urlStr = (checkUrl || `https://${hostname}`).trim();
  const started = Date.now();
  let httpStatus: number | null = null;
  let reachable = false;
  let certExpiry: Date | null = null;
  let certIssuer: string | null = null;
  let error: string | null = null;
  try {
    const target = new URL(urlStr);
    for (const method of ['HEAD', 'GET'] as const) {
      try {
        const resp = await fetch(urlStr, {
          method,
          redirect: 'follow',
          signal: AbortSignal.timeout(12_000),
        });
        httpStatus = resp.status;
        reachable = resp.status < 500;
        break;
      } catch (e) {
        error = String(e);
      }
    }
    if (target.protocol === 'https:') {
      try {
        const tlsMeta = await getTlsCertMeta(
          target.hostname,
          target.port ? Number(target.port) : 443,
        );
        certExpiry = tlsMeta.validTo;
        certIssuer = tlsMeta.issuer;
      } catch (e) {
        error = error ? `${error}; TLS: ${e}` : `TLS: ${e}`;
      }
    }
  } catch (e) {
    error = String(e);
  }
  return {
    reachable,
    httpStatus,
    responseMs: Date.now() - started,
    certExpiry,
    certIssuer,
    error,
  };
};

const runDomainCheck = async (domainId: string) => {
  const domain = await db.domain.findUnique({ where: { id: domainId } });
  if (!domain || !domain.enabled) return null;
  const result = await probeDomain(domain.hostname, domain.checkUrl);
  return db.domainCheck.create({
    data: {
      domainId: domain.id,
      reachable: result.reachable,
      httpStatus: result.httpStatus,
      responseMs: result.responseMs,
      certExpiry: result.certExpiry,
      certIssuer: result.certIssuer,
      error: result.error,
    },
  });
};

app.get('/health', (_q, r) => ok(r, { status: 'ok' }));
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, "Email and password are required");
  let user = await db.user.findUnique({
    where: { email: String(email).toLowerCase() },
  });
  if (
    !user &&
    process.env.ADMIN_EMAIL &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase() &&
    process.env.ADMIN_PASSWORD &&
    password === process.env.ADMIN_PASSWORD
  ) {
    user = await db.user.create({
      data: {
        email: process.env.ADMIN_EMAIL.toLowerCase(),
        passwordHash: await argon2.hash(String(password)),
      },
    });
  }
  if (!user || !(await argon2.verify(user.passwordHash, String(password))))
    return fail(res, "Invalid credentials", 401);
  (req.session as any).userId = user.id;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
  await audit(
    { ...req, userId: user.id } as Authed,
    'auth.login',
    'user',
    user.id,
    'success',
  );
  ok(res, { id: user.id, email: user.email });
});
app.post("/auth/logout", auth, async (req: Authed, res) => {
  await audit(req, "auth.logout", "user", req.userId!, "success");
  req.session.destroy(() => ok(res, { loggedOut: true }));
});
app.get("/auth/me", auth, async (req: Authed, res) => {
  const u = await db.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, email: true, createdAt: true },
  });
  ok(res, u);
});
app.post("/security/passcode/setup", auth, async (req: Authed, res) => {
  const pin = String(req.body?.pin || "");
  if (!/^\d{4}$/.test(pin))
    return fail(res, "Passcode must contain exactly four digits");
  const user = await db.user.findUnique({ where: { id: req.userId! } });
  if (user?.securityPinHash) {
    const current = String(req.body?.currentPin || "");
    if (
      !/^\d{4}$/.test(current) ||
      !(await argon2.verify(
        user.securityPinHash,
        current + (process.env.PIN_PEPPER || ""),
      ))
    )
      return fail(res, "Current passcode is incorrect", 403);
  }
  await db.user.update({
    where: { id: req.userId! },
    data: {
      securityPinHash: await argon2.hash(pin + (process.env.PIN_PEPPER || "")),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });
  await audit(req, "security.pin.updated", "user", req.userId!, "success");
  ok(res, { configured: true });
});
app.post("/operations", auth, pinLimiter, async (req: Authed, res) => {
  const { action, resourceId, passcode } = req.body || {};
  if (!/^\d{4}$/.test(String(passcode || "")))
    return fail(res, "A four-digit passcode is required", 403);
  const user = await db.user.findUnique({ where: { id: req.userId! } });
  if (!user?.securityPinHash)
    return fail(res, "Configure your security passcode in Settings first", 403);
  if (user.pinLockedUntil && user.pinLockedUntil.getTime() > Date.now())
    return fail(res, "Passcode temporarily locked", 423);
  const valid = await argon2.verify(
    user.securityPinHash,
    String(passcode) + (process.env.PIN_PEPPER || ""),
  );
  if (!valid) {
    const attempts = user.pinFailedAttempts + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        pinFailedAttempts: attempts,
        pinLockedUntil:
          attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
    await audit(
      req,
      "security.pin.failed",
      "operation",
      String(action),
      "denied",
    );
    return fail(res, "Incorrect passcode", 403);
  }
  await db.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  });
  const allowed = [
    "host.reboot",
    "host.shutdown",
    "host.docker-restart",
    "container.start",
    "container.stop",
    "container.restart",
  ];
  if (!allowed.includes(action)) return fail(res, "Operation is not allowed");
  let result: any;
  try {
    if (action.startsWith("container.")) {
      const r = await fetch(
        `${process.env.DOCKER_GATEWAY_URL}/${action.replace("container.", "containers/")}/${encodeURIComponent(String(resourceId))}`,
        {
          method:
            action === "container.start"
              ? "POST"
              : action === "container.stop"
                ? "POST"
                : "POST",
          headers: {
            Authorization: `Bearer ${process.env.DOCKER_GATEWAY_TOKEN}`,
          },
        },
      );
      if (!r.ok) throw new Error(await r.text());
      result = await r.json();
    } else {
      const r = await fetch(
        `${process.env.HOST_HELPER_URL}/operations/${action.split(".")[1]}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.HOST_HELPER_TOKEN}` },
        },
      );
      if (!r.ok) throw new Error(await r.text());
      result = await r.json();
    }
    await audit(req, action, "operation", resourceId || "host", "accepted");
    ok(res, { accepted: true, result }, 202);
  } catch (e) {
    await audit(req, action, "operation", resourceId || "host", "failed", {
      error: String(e),
    });
    return fail(res, "Operation could not be executed", 502);
  }
});
const ALERT_SETTINGS_KEY = 'alert_settings';
const IN_APP_ALERTS_KEY = 'in_app_alerts';
const ALERT_COOLDOWN_KEY = 'alert_cooldowns';

type AlertSettings = {
  cpuThreshold: number;
  diskThreshold: number;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  cooldownMinutes: number;
};

type InAppAlert = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  read: boolean;
};

const defaultAlertSettings = (): AlertSettings => ({
  cpuThreshold: 90,
  diskThreshold: 90,
  emailEnabled: false,
  inAppEnabled: true,
  cooldownMinutes: 60,
});

const loadAlertSettings = async (): Promise<AlertSettings> => {
  const row = await db.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } });
  if (!row?.value || typeof row.value !== 'object') return defaultAlertSettings();
  return { ...defaultAlertSettings(), ...(row.value as AlertSettings) };
};

const loadInAppAlerts = async (): Promise<InAppAlert[]> => {
  const row = await db.setting.findUnique({ where: { key: IN_APP_ALERTS_KEY } });
  if (!Array.isArray(row?.value)) return [];
  return row!.value as InAppAlert[];
};

const saveInAppAlerts = async (items: InAppAlert[]) => {
  await db.setting.upsert({
    where: { key: IN_APP_ALERTS_KEY },
    update: { value: items.slice(0, 100) },
    create: { key: IN_APP_ALERTS_KEY, value: items.slice(0, 100) },
  });
};

const pushInAppAlert = async (message: string, type = 'metric') => {
  const items = await loadInAppAlerts();
  items.unshift({
    id: randomUUID(),
    type,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  });
  await saveInAppAlerts(items);
};

const canSendAlert = async (key: string, cooldownMinutes: number) => {
  const row = await db.setting.findUnique({ where: { key: ALERT_COOLDOWN_KEY } });
  const map = (row?.value as Record<string, string>) || {};
  const last = map[key] ? new Date(map[key]).getTime() : 0;
  if (Date.now() - last < cooldownMinutes * 60_000) return false;
  map[key] = new Date().toISOString();
  await db.setting.upsert({
    where: { key: ALERT_COOLDOWN_KEY },
    update: { value: map },
    create: { key: ALERT_COOLDOWN_KEY, value: map },
  });
  return true;
};

const sendAlertEmail = async (subject: string, text: string) => {
  if (!process.env.SMTP_HOST?.trim()) return;
  const recipients = await db.recipient.findMany({ where: { active: true } });
  if (!recipients.length) return;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  for (const r of recipients) {
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: r.email,
        subject,
        text,
      });
    } catch {
      /* skip recipient */
    }
  }
};

const evaluateMetricAlerts = async (host: {
  cpu?: number | null;
  disk?: number | null;
}) => {
  const settings = await loadAlertSettings();
  const checks: { key: string; label: string; value: number; threshold: number }[] = [];
  if (typeof host.cpu === 'number' && host.cpu >= settings.cpuThreshold) {
    checks.push({
      key: 'cpu',
      label: 'CPU',
      value: host.cpu,
      threshold: settings.cpuThreshold,
    });
  }
  if (typeof host.disk === 'number' && host.disk >= settings.diskThreshold) {
    checks.push({
      key: 'disk',
      label: 'Disk',
      value: host.disk,
      threshold: settings.diskThreshold,
    });
  }
  for (const c of checks) {
    if (!(await canSendAlert(`metric-${c.key}`, settings.cooldownMinutes))) continue;
    const message = `${c.label} usage is ${c.value}% (threshold ${c.threshold}%)`;
    if (settings.inAppEnabled) await pushInAppAlert(message, 'metric');
    if (settings.emailEnabled) {
      await sendAlertEmail(
        `[Homelab] ${c.label} alert`,
        `${message}\n\nHomelab Central metric alert`,
      );
    }
  }
};

const probeAppHealth = async (target: string): Promise<string> => {
  const url = target.trim();
  if (!url) return 'unknown';
  try {
    const start = Date.now();
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'HomelabCentral-Health/1.0' },
    });
    const ms = Date.now() - start;
    if (r.status >= 500) return 'down';
    if (r.status >= 400) return 'degraded';
    if (ms > 3000) return 'degraded';
    return 'healthy';
  } catch {
    return 'down';
  }
};

const runApplicationHealthChecks = async () => {
  const apps = await db.application.findMany({ where: { enabled: true } });
  for (const app of apps) {
    const target = app.healthCheckUrl?.trim() || app.url;
    const healthStatus = await probeAppHealth(target);
    await db.application.update({
      where: { id: app.id },
      data: { healthStatus },
    });
  }
};

const wudPublicBase = () => process.env.WUD_URL?.replace(/\/$/, '') || null;

const mapWudItem = (c: any) => {
  const imageName = c.image?.name || c.image?.id?.image || '';
  const availableTag = c.result?.tag || '';
  const pullCommand =
    imageName && availableTag
      ? `docker pull ${imageName.includes(':') ? imageName.split(':')[0] : imageName}:${availableTag}`
      : null;
  const base = wudPublicBase();
  // WUD uses a single containers list — no per-container detail route.
  const wudLink = base ? `${base}/containers` : null;
  return {
    id: c.id,
    name: c.name,
    image: imageName,
    currentTag: c.image?.tag?.value,
    availableTag,
    updateKind: c.updateKind?.semverDiff || c.updateKind?.kind || 'update',
    watcher: c.watcher,
    pullCommand,
    wudLink,
  };
};

const persistHostMetrics = async (host: {
  cpu?: number | null;
  memory?: number | null;
  disk?: number | null;
}) => {
  const rows: { name: string; value: number; unit: string }[] = [];
  if (typeof host.cpu === 'number')
    rows.push({ name: 'cpu', value: host.cpu, unit: 'percent' });
  if (typeof host.memory === 'number')
    rows.push({ name: 'memory', value: host.memory, unit: 'percent' });
  if (typeof host.disk === 'number')
    rows.push({ name: 'disk', value: host.disk, unit: 'percent' });
  if (rows.length) {
    await db.metricSample.createMany({ data: rows }).catch(() => undefined);
  }
  await evaluateMetricAlerts(host);
};

app.get("/dashboard/summary", auth, async (_q, res) => {
  try {
    const r = await fetch(`${process.env.HOST_HELPER_URL}/metrics`, {
      headers: { Authorization: `Bearer ${process.env.HOST_HELPER_TOKEN}` },
      signal: AbortSignal.timeout(2500),
    });
    const host = r.ok ? await r.json() : {};
    void persistHostMetrics(host).catch(() => undefined);
    const c = await fetch(`${process.env.DOCKER_GATEWAY_URL}/containers`, {
      headers: { Authorization: `Bearer ${process.env.DOCKER_GATEWAY_TOKEN}` },
    });
    const cs = c.ok ? await c.json() : [];
    ok(res, {
      ...host,
      containers: {
        running: cs.filter((x: any) => x.running).length,
        total: cs.length,
      },
      status: "Online",
    });
  } catch {
    ok(res, {
      status: "Host metrics unavailable",
      containers: { running: 0, total: 0 },
    });
  }
});

app.get("/metrics/history", auth, async (req, res) => {
  const hours = Math.min(
    168,
    Math.max(1, Number(req.query.hours) || 6),
  );
  const since = new Date(Date.now() - hours * 3_600_000);
  const samples = await db.metricSample.findMany({
    where: { collectedAt: { gte: since } },
    orderBy: { collectedAt: "asc" },
    take: 2000,
  });
  const series: Record<string, { t: string; v: number }[]> = {};
  for (const s of samples) {
    (series[s.name] ||= []).push({
      t: s.collectedAt.toISOString(),
      v: s.value,
    });
  }
  ok(res, { series, since: since.toISOString() });
});
app.get("/docker/containers", auth, async (_q, res) => {
  try {
    const r = await fetch(`${process.env.DOCKER_GATEWAY_URL}/containers`, {
      headers: { Authorization: `Bearer ${process.env.DOCKER_GATEWAY_TOKEN}` },
    });
    if (!r.ok) throw new Error();
    ok(res, { items: await r.json() });
  } catch {
    fail(res, "Docker gateway unavailable", 503);
  }
});
app.get("/applications", auth, async (_q, res) =>
  ok(res, {
    items: await db.application.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    }),
  }),
);
app.post("/applications", auth, async (req: Authed, res) => {
  const a = await db.application.create({ data: req.body });
  await audit(req, "application.created", "application", a.id, "success");
  ok(res, a, 201);
});
app.put("/applications/:id", auth, async (req, res) =>
  ok(
    res,
    await db.application.update({
      where: { id: routeParam(req.params.id) },
      data: req.body,
    }),
  ),
);
app.delete("/applications/:id", auth, async (req: Authed, res) => {
  await db.application.delete({ where: { id: routeParam(req.params.id) } });
  await audit(
    req,
    "application.deleted",
    "application",
    routeParam(req.params.id),
    "success",
  );
  ok(res, { deleted: true });
});
app.get("/activities", auth, async (req, res) =>
  ok(res, {
    items: await db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 50, 200),
    }),
  }),
);
app.get("/notifications/recipients", auth, async (_q, res) =>
  ok(res, { items: await db.recipient.findMany({ where: { active: true } }) }),
);
app.post("/notifications/recipients", auth, async (req, res) =>
  ok(res, await db.recipient.create({ data: req.body }), 201),
);
app.put("/notifications/recipients/:id", auth, async (req, res) =>
  ok(
    res,
    await db.recipient.update({
      where: { id: routeParam(req.params.id) },
      data: req.body,
    }),
  ),
);
app.delete("/notifications/recipients/:id", auth, async (req: Authed, res) => {
  await db.recipient.update({
    where: { id: routeParam(req.params.id) },
    data: { active: false },
  });
  await audit(
    req,
    "notification.recipient.disabled",
    "recipient",
    routeParam(req.params.id),
    "success",
  );
  ok(res, { disabled: true });
});
app.get("/notifications/history", auth, async (_q, res) =>
  ok(res, {
    items: await db.emailLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  }),
);
app.post("/notifications/send", auth, async (req: Authed, res) => {
  const { title, description, subject, recipientIds, startAt, endAt } =
    req.body || {};
  const titleText = String(title || '').trim();
  const subjectText = String(subject || '').trim();
  if (!titleText) return fail(res, 'Maintenance title is required');
  if (!subjectText) return fail(res, 'Email subject is required');
  if (!Array.isArray(recipientIds) || !recipientIds.length) {
    return fail(res, 'Select at least one recipient (add recipients below if the list is empty)');
  }
  const recipients = await db.recipient.findMany({
    where: { id: { in: recipientIds }, active: true },
  });
  if (!recipients.length) return fail(res, "No active recipients selected");
  if (!process.env.SMTP_HOST?.trim()) {
    return fail(
      res,
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_FROM (and SMTP_USER/SMTP_PASSWORD if required) in .env, then restart the API.',
      503,
    );
  }
  const event = await db.maintenanceEvent.create({
    data: {
      title: titleText,
      description,
      subject: subjectText,
      status: 'sending',
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
    },
  });
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  try {
    await transport.verify();
  } catch (e) {
    await db.maintenanceEvent.update({
      where: { id: event.id },
      data: { status: 'failed' },
    });
    return fail(res, `SMTP connection failed: ${String(e)}`, 502);
  }
  let sent = 0;
  let failed = 0;
  const delivery: { email: string; status: string; error?: string }[] = [];
  for (const recipient of recipients) {
    try {
      const info = await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: recipient.email,
        subject: subjectText,
        text: `${titleText}\n\n${description || ''}\n\nStart: ${startAt || 'TBD'}\nExpected end: ${endAt || 'TBD'}`,
      });
      sent += 1;
      delivery.push({ email: recipient.email, status: 'sent' });
      await db.emailLog.create({
        data: {
          maintenanceId: event.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          subject: subjectText,
          status: 'sent',
          providerMessageId: info.messageId,
        },
      });
    } catch (e) {
      failed += 1;
      const err = String(e);
      delivery.push({ email: recipient.email, status: 'failed', error: err });
      await db.emailLog.create({
        data: {
          maintenanceId: event.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          subject: subjectText,
          status: 'failed',
          error: err,
        },
      });
    }
  }
  const finalStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  await db.maintenanceEvent.update({
    where: { id: event.id },
    data: { status: finalStatus },
  });
  await audit(
    req,
    'maintenance.notification.sent',
    'maintenance',
    event.id,
    finalStatus,
    { sent, failed },
  );
  if (sent === 0) {
    return fail(res, `Email could not be sent to any recipient. Check SMTP and see Maintenance → history.`, 502);
  }
  ok(
    res,
  {
      eventId: event.id,
      sent,
      failed,
      delivery,
      message:
        failed === 0
          ? `Sent to ${sent} recipient(s).`
          : `Sent to ${sent}, failed for ${failed}. See notification history for details.`,
    },
    failed ? 207 : 200,
  );
});
app.post('/applications/health-check', auth, async (req: Authed, res) => {
  await runApplicationHealthChecks();
  await audit(req, 'application.health_check', 'application', null, 'success');
  ok(res, { ok: true });
});
app.get('/settings/alerts', auth, async (_q, res) => {
  ok(res, await loadAlertSettings());
});
app.put('/settings/alerts', auth, async (req: Authed, res) => {
  const body = req.body || {};
  const next: AlertSettings = {
    cpuThreshold: Math.min(100, Math.max(1, Number(body.cpuThreshold) || 90)),
    diskThreshold: Math.min(100, Math.max(1, Number(body.diskThreshold) || 90)),
    emailEnabled: !!body.emailEnabled,
    inAppEnabled: body.inAppEnabled !== false,
    cooldownMinutes: Math.min(24 * 60, Math.max(5, Number(body.cooldownMinutes) || 60)),
  };
  await db.setting.upsert({
    where: { key: ALERT_SETTINGS_KEY },
    update: { value: next },
    create: { key: ALERT_SETTINGS_KEY, value: next },
  });
  await audit(req, 'settings.alerts.updated', 'setting', ALERT_SETTINGS_KEY, 'success');
  ok(res, next);
});
app.get('/notifications/alerts', auth, async (_q, res) => {
  ok(res, { items: await loadInAppAlerts() });
});
app.post('/notifications/alerts/:id/read', auth, async (req, res) => {
  const id = routeParam(req.params.id);
  const items = await loadInAppAlerts();
  const idx = items.findIndex((a) => a.id === id);
  if (idx >= 0) items[idx].read = true;
  await saveInAppAlerts(items);
  ok(res, { ok: true });
});
app.post('/notifications/alerts/read-all', auth, async (_q, res) => {
  const items = (await loadInAppAlerts()).map((a) => ({ ...a, read: true }));
  await saveInAppAlerts(items);
  ok(res, { ok: true });
});
const WUD_CACHE_KEY = 'wud_updates_cache';

const wudRequest = async (path: string, init?: RequestInit) => {
  const base = process.env.WUD_URL?.replace(/\/$/, '');
  if (!base) return null;
  const headers = new Headers(init?.headers);
  if (process.env.WUD_API_TOKEN) {
    headers.set('Authorization', `Bearer ${process.env.WUD_API_TOKEN}`);
  } else if (process.env.WUD_USER && process.env.WUD_PASSWORD) {
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${process.env.WUD_USER}:${process.env.WUD_PASSWORD}`).toString('base64')}`,
    );
  }
  return fetch(`${base}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(25_000),
  });
};

const pullWudUpdates = async () => {
  if (!process.env.WUD_URL) return { configured: false as const, items: [] as any[] };
  try {
    await wudRequest('/api/containers/watch', { method: 'POST' });
  } catch {
    /* optional */
  }
  const listRes = await wudRequest('/api/containers');
  if (!listRes?.ok) throw new Error("Could not reach What's Up Docker");
  const raw = await listRes.json();
  const containers = Array.isArray(raw) ? raw : [];
  const items = containers
    .filter((c: { updateAvailable?: boolean }) => c.updateAvailable)
    .map((c: any) => mapWudItem(c));
  return { configured: true as const, items };
};

const saveWudCache = async (items: any[]) => {
  const payload = { items, scannedAt: new Date().toISOString() };
  await db.setting.upsert({
    where: { key: WUD_CACHE_KEY },
    update: { value: payload },
    create: { key: WUD_CACHE_KEY, value: payload },
  });
  return payload;
};

const loadWudCache = async () => {
  const row = await db.setting.findUnique({ where: { key: WUD_CACHE_KEY } });
  if (!row?.value || typeof row.value !== 'object') return null;
  return row.value as { items: any[]; scannedAt: string };
};

app.get('/updates', auth, async (_q, res) => {
  const cache = await loadWudCache();
  const ageMs = cache?.scannedAt
    ? Date.now() - new Date(cache.scannedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const stale = ageMs > 15 * 60 * 1000;
  if (process.env.WUD_URL && stale) {
    try {
      const { items } = await pullWudUpdates();
      const fresh = await saveWudCache(items);
      return ok(res, {
        configured: true,
        items,
        scannedAt: fresh.scannedAt,
        refreshed: true,
        wudUrl: wudPublicBase(),
      });
    } catch {
      /* use cache below */
    }
  }
  ok(res, {
    configured: !!process.env.WUD_URL,
    items: cache?.items || [],
    scannedAt: cache?.scannedAt || null,
    refreshed: false,
    wudUrl: wudPublicBase(),
  });
});

app.post('/updates/scan', auth, async (_q, res) => {
  try {
    const { configured, items } = await pullWudUpdates();
    if (!configured) {
      return ok(res, {
        configured: false,
        items: [],
        scannedAt: null,
        message:
          "Set WUD_URL in .env to your What's Up Docker base URL (plus WUD_API_TOKEN or WUD_USER/WUD_PASSWORD).",
      });
    }
    const cache = await saveWudCache(items);
    ok(res, {
      configured: true,
      items,
      scannedAt: cache.scannedAt,
      wudUrl: wudPublicBase(),
      message: items.length
        ? `${items.length} update(s) from What's Up Docker`
        : 'All watched images are up to date',
    });
  } catch (e) {
    return fail(res, String(e), 502);
  }
});
app.get("/domains", auth, async (_q, res) =>
  ok(res, {
    items: await db.domain
      .findMany({
        include: { checks: { orderBy: { checkedAt: "desc" }, take: 1 } },
      })
      .then((ds) => ds.map((d) => ({ ...d, lastCheck: d.checks[0] || null }))),
  }),
);
app.post("/domains", auth, async (req, res) =>
  ok(res, await db.domain.create({ data: req.body }), 201),
);
app.put("/domains/:id", auth, async (req, res) =>
  ok(
    res,
    await db.domain.update({
      where: { id: routeParam(req.params.id) },
      data: req.body,
    }),
  ),
);
app.delete('/domains/:id', auth, async (req: Authed, res) => {
  await db.domain.delete({ where: { id: routeParam(req.params.id) } });
  await audit(
    req,
    'domain.deleted',
    'domain',
    routeParam(req.params.id),
    'success',
  );
  ok(res, { deleted: true });
});
app.post('/domains/:id/check', auth, async (req: Authed, res) => {
  const id = routeParam(req.params.id);
  try {
    const check = await runDomainCheck(id);
    if (!check) return fail(res, 'Domain not found or disabled', 404);
    await audit(req, 'domain.checked', 'domain', id, 'success');
    ok(res, { check });
  } catch (e) {
    await audit(req, 'domain.checked', 'domain', id, 'failed', { error: String(e) });
    return fail(res, 'Domain check failed', 502);
  }
});
app.post('/domains/check-all', auth, async (req: Authed, res) => {
  const domains = await db.domain.findMany({ where: { enabled: true } });
  const results = [];
  for (const domain of domains) {
    try {
      results.push({ domainId: domain.id, check: await runDomainCheck(domain.id) });
    } catch (e) {
      results.push({ domainId: domain.id, error: String(e) });
    }
  }
  await audit(req, 'domain.check_all', 'domain', null, 'success', { count: domains.length });
  ok(res, { checked: results.length, results });
});
setTimeout(() => {
  void runApplicationHealthChecks().catch(() => undefined);
}, 12_000);
setInterval(() => {
  void runApplicationHealthChecks().catch(() => undefined);
}, 5 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () =>
  console.log(`Homelab Central API listening on ${PORT}`),
);
