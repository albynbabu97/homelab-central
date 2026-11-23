import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
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
    name: "hc.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
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
app.get("/health", (_q, r) => ok(r, { status: "ok" }));
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
  await audit(
    { ...req, userId: user.id } as Authed,
    "auth.login",
    "user",
    user.id,
    "success",
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
app.get("/dashboard/summary", auth, async (_q, res) => {
  try {
    const r = await fetch(`${process.env.HOST_HELPER_URL}/metrics`, {
      headers: { Authorization: `Bearer ${process.env.HOST_HELPER_TOKEN}` },
      signal: AbortSignal.timeout(2500),
    });
    const host = r.ok ? await r.json() : {};
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
  if (
    !title ||
    !subject ||
    !Array.isArray(recipientIds) ||
    !recipientIds.length
  )
    return fail(res, "Title, subject and recipients are required");
  const recipients = await db.recipient.findMany({
    where: { id: { in: recipientIds }, active: true },
  });
  if (!recipients.length) return fail(res, "No active recipients selected");
  const event = await db.maintenanceEvent.create({
    data: {
      title,
      description,
      subject,
      status: "queued",
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
    },
  });
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  for (const recipient of recipients) {
    try {
      const info = await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: recipient.email,
        subject,
        text: `${title}\n\n${description || ""}\n\nStart: ${startAt || "TBD"}\nExpected end: ${endAt || "TBD"}`,
      });
      await db.emailLog.create({
        data: {
          maintenanceId: event.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          subject,
          status: "submitted",
          providerMessageId: info.messageId,
        },
      });
    } catch (e) {
      await db.emailLog.create({
        data: {
          maintenanceId: event.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          subject,
          status: "failed",
          error: String(e),
        },
      });
    }
  }
  await audit(
    req,
    "maintenance.notification.sent",
    "maintenance",
    event.id,
    "success",
  );
  ok(res, { eventId: event.id }, 202);
});
app.get("/backups", auth, async (_q, res) =>
  ok(res, {
    items: await db.backup.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  }),
);
app.post("/backups", auth, async (req: Authed, res) => {
  const b = await db.backup.create({
    data: {
      name: `${req.body?.type || "config"}-${new Date().toISOString()}`,
      type: req.body?.type || "config",
      status: "queued",
    },
  });
  await audit(req, "backup.requested", "backup", b.id, "accepted");
  ok(res, { id: b.id, status: b.status }, 202);
});
app.post("/updates/scan", auth, async (_q, res) =>
  ok(res, {
    items: [],
    message: "Image update scanning adapter is not configured yet.",
  }),
);
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
app.delete("/domains/:id", auth, async (req: Authed, res) => {
  await db.domain.delete({ where: { id: routeParam(req.params.id) } });
  await audit(
    req,
    "domain.deleted",
    "domain",
    routeParam(req.params.id),
    "success",
  );
  ok(res, { deleted: true });
});
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Homelab Central API listening on ${PORT}`),
);
