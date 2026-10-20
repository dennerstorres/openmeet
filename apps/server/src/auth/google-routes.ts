import type { FastifyInstance } from "fastify";
import type { MigrationClient } from "../db/migrate.js";
import type { AppEnv } from "../poc-join.js";
import { finishGoogleLogin, googleConfig, liveGoogleTokens, pollGoogleLogin, startGoogleLogin, type GoogleTokens } from "./google.js";
import { clientAddress, headerValue, ProxyRejected, type AttemptPolicy } from "./limit.js";
import { AuthError } from "./service.js";
import { sendSession, webMode } from "./web-session.js";

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const MESSAGES: Record<string, [string, string]> = {
  done: ["Pode voltar ao OpenMeet", "A entrada foi confirmada. Feche esta aba e volte ao aplicativo."],
  google_denied: ["Entrada cancelada", "O Google não confirmou a entrada. Volte ao OpenMeet e tente de novo."],
  google_failed: ["Não deu certo", "A conta Google não pôde ser confirmada. Volte ao OpenMeet e tente de novo, ou entre com usuário e senha."],
  account_disabled: ["Conta desativada", "Esta conta não pode entrar nesta instância."],
  expired: ["Pedido expirado", "Este pedido de entrada já foi usado ou expirou. Volte ao OpenMeet e comece de novo."],
};

function page(outcome: string): string {
  const [title, body] = MESSAGES[outcome] ?? MESSAGES.expired ?? ["", ""];
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111613;color:#e7f2ea;font-family:"Segoe UI",system-ui,sans-serif}
main{max-width:420px;padding:24px;text-align:center}
p{color:#9bb0a2;line-height:1.5}
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`;
}

function query(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}

export function registerGoogle(
  app: FastifyInstance,
  env: AppEnv,
  db: MigrationClient | undefined,
  attempts: AttemptPolicy,
  tokens: GoogleTokens = liveGoogleTokens,
): void {
  const config = googleConfig(env);
  const secret = (env.AUTH_SECRET ?? "").length >= 32 ? env.AUTH_SECRET : undefined;

  app.post("/api/v1/auth/google/start", async (request, reply) => {
    if (!config || !db || !secret) return reply.code(404).send({ error: "google_unconfigured" });
    let ip: string;
    try {
      ip = clientAddress(
        request.ip,
        { forwarded: headerValue(request.headers["x-forwarded-for"]), proxy: headerValue(request.headers["x-openmeet-proxy"]) },
        attempts,
      );
    } catch (error) {
      if (error instanceof ProxyRejected) return reply.code(503).send({ error: "proxy_rejected" });
      throw error;
    }
    if (!attempts.loginIp.allow(`google:${ip}`, attempts.now())) return reply.code(429).send({ error: "rate_limited" });
    try {
      return reply
        .code(201)
        .header("cache-control", "no-store")
        .send(await startGoogleLogin(db, config));
    } catch {
      request.log.error({ code: "google_start_failed" }, "google start failed");
      return reply.code(503).send({ error: "google_failed" });
    }
  });

  app.get("/api/v1/auth/google/callback", async (request, reply) => {
    reply.headers(PAGE_HEADERS).type("text/html; charset=utf-8");
    if (!config || !db) return reply.code(404).send(page("expired"));
    try {
      const outcome = await finishGoogleLogin(db, config, tokens, {
        state: query(request.query, "state"),
        code: query(request.query, "code"),
        error: query(request.query, "error"),
      });
      return reply.code(outcome === "done" ? 200 : 400).send(page(outcome));
    } catch {
      request.log.error({ code: "google_callback_failed" }, "google callback failed");
      return reply.code(500).send(page("google_failed"));
    }
  });

  app.post("/api/v1/auth/google/poll", async (request, reply) => {
    if (!config || !db || !secret) return reply.code(404).send({ error: "google_unconfigured" });
    if (webMode(request, env) === "rejected") return reply.code(403).send({ error: "origin_rejected" });
    const poll = typeof request.body === "object" && request.body !== null ? query(request.body, "poll") : undefined;
    try {
      const result = await pollGoogleLogin(db, secret, poll ?? "");
      if (result.status === "pending") return reply.code(202).header("cache-control", "no-store").send({ status: "pending" });
      if (result.status === "failed") return reply.code(403).header("cache-control", "no-store").send({ error: result.failure });
      return sendSession(request, reply, env, 200, result.session);
    } catch (error) {
      if (error instanceof AuthError) return reply.code(401).send({ error: "invalid_session" });
      request.log.error({ code: "google_poll_failed" }, "google poll failed");
      return reply.code(500).send({ error: "auth_failed" });
    }
  });
}
