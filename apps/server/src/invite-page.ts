import type { FastifyInstance } from "fastify";

// ADR 0012. A browser that opens the invite gets a page that only sends it back to the app.
// No session, no script, no lookup: the page does not reveal whether the code is valid.

const CODE = /^[A-Za-z0-9_-]{43}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[0-9]{1,5})?$/;
const INVITE_PATH = /^\/convite\/[^?#]*/;

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const GOOGLE_CALLBACK = /^\/api\/v1\/auth\/google\/callback\?.*$/;

/** The request log never carries the invite code, nor the Google code and state. */
export function redactInviteUrl(url: string): string {
  return url.replace(INVITE_PATH, "/convite/[redacted]").replace(GOOGLE_CALLBACK, "/api/v1/auth/google/callback?[redacted]");
}

function page(body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Convite do OpenMeet</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111613;color:#e7f2ea;font-family:"Segoe UI",system-ui,sans-serif}
main{max-width:420px;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;padding:10px 16px;border-radius:8px;background:#23a559;color:#06210f;font-weight:700;text-decoration:none}
a+a{margin-left:8px}
p{color:#9bb0a2;line-height:1.5}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/**
 * ADR 0014: with the web client installed, the page also offers it. The code goes in the fragment,
 * which the browser never sends, so it reaches no request log on the way to the client.
 */
export function registerInvitePage(app: FastifyInstance, webClient = false): void {
  app.get("/convite/:code", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const code = typeof params.code === "string" ? params.code : "";
    const host = request.host.toLowerCase();
    reply.headers(PAGE_HEADERS).type("text/html; charset=utf-8");
    if (!CODE.test(code) || !HOST.test(host)) {
      return reply.code(404).send(page("<h1>Convite inválido</h1><p>Peça um novo convite a quem administra o servidor.</p>"));
    }
    // Both values passed the strict patterns above, so they carry no HTML or URL syntax.
    const link = `openmeet://convite?host=${encodeURIComponent(host)}&amp;code=${code}`;
    const body = webClient
      ? `<h1>Convite do OpenMeet</h1><p>Abra o convite no aplicativo OpenMeet ou direto no navegador.</p><a href="${link}">Abrir no OpenMeet</a> <a href="/#convite=${code}">Abrir no navegador</a>`
      : `<h1>Convite do OpenMeet</h1><p>Este convite abre no aplicativo OpenMeet. Se ele não abriu sozinho, use o botão abaixo.</p><a href="${link}">Abrir no OpenMeet</a><p>Sem o aplicativo? Instale o OpenMeet e abra este link de novo.</p>`;
    return reply.code(200).send(page(body));
  });
}
