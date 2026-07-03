function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function corsOriginsFromEnv(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    return raw.split(",").map((o) => o.trim()).filter(Boolean);
  }
  // No explicit origins configured — only safe to fall back to "allow all"
  // outside production. In production, silently defaulting to "*" (with
  // credentials: true in app.ts) is an open CORS misconfiguration, so fail
  // fast at boot instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error("CORS_ORIGINS is required in production — refusing to default to '*'");
  }
  return ["*"];
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: required("JWT_SECRET"),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: corsOriginsFromEnv(),
  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;

export const APP_VERSION = "0.1.0";
