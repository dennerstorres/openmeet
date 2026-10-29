import type { FastifyInstance } from "fastify";

// Public privacy and terms pages, the links the Google consent screen asks for (ADR 0010).
// Static text, no script, no lookup: the same page for every visitor.

const PAGE_HEADERS = {
  "cache-control": "public, max-age=3600",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · OpenMeet</title>
<style>
body{margin:0;background:#111613;color:#e7f2ea;font-family:"Segoe UI",system-ui,sans-serif;line-height:1.6}
main{max-width:680px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:18px;margin:28px 0 4px}
p,li{color:#c3d3c8}
.meta{color:#9bb0a2;font-size:14px}
a{color:#4ade80}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const UPDATED = "29 de outubro de 2026";

const PRIVACY = page(
  "Política de Privacidade",
  `<h1>Política de Privacidade</h1>
<p class="meta">Atualizada em ${UPDATED}</p>
<p>Esta é uma instância privada do OpenMeet, mantida por quem a administra para um grupo fechado de pessoas convidadas. Não há anúncios, venda de dados nem compartilhamento com terceiros para fins comerciais.</p>
<h2>O que é guardado</h2>
<ul>
<li>Conta: usuário, nome de exibição, papel e, se você criar, senha guardada só como hash.</li>
<li>Entrada com Google: o identificador da conta Google, o e-mail e o nome. Nenhum token do Google é guardado, e não pedimos acesso a e-mails, arquivos ou contatos.</li>
<li>Conteúdo que você envia: mensagens, reações, anexos, fotos de perfil, emojis e sons.</li>
<li>Registros técnicos de segurança: sessões, eventos de auditoria e endereço IP para limitar tentativas de acesso.</li>
</ul>
<h2>Chamadas</h2>
<p>Áudio, vídeo e tela passam pelo servidor de mídia desta instância em tempo real para chegar aos outros participantes.</p>
<h2>Para que é usado</h2>
<p>Só para fazer o serviço funcionar: entrar, mostrar quem é você aos outros membros, entregar mensagens e chamadas, e proteger a instância contra abuso.</p>
<h2>Onde fica e por quanto tempo</h2>
<p>Os dados ficam no servidor desta instância enquanto a conta existir. Para pedir acesso, correção ou exclusão dos seus dados, fale com quem administra a instância.</p>`,
);

const TERMS = page(
  "Termos de Serviço",
  `<h1>Termos de Serviço</h1>
<p class="meta">Atualizados em ${UPDATED}</p>
<p>Esta é uma instância privada do OpenMeet, aberta só a pessoas convidadas por quem a administra. Ao entrar, você concorda com estes termos.</p>
<h2>Acesso</h2>
<p>A entrada depende de convite. O administrador pode desativar contas, remover membros e apagar conteúdo para manter a instância segura.</p>
<h2>Uso aceitável</h2>
<p>Não use a instância para atividade ilegal, assédio, spam, conteúdo que viole direitos de terceiros ou tentativas de burlar a segurança do serviço.</p>
<h2>Seu conteúdo</h2>
<p>O que você envia continua seu. Você permite que a instância o guarde e o mostre às pessoas com quem você o compartilhou.</p>
<h2>Sem garantia</h2>
<p>O serviço é oferecido como está, sem garantia de disponibilidade ou de preservação de dados. Pode mudar ou ser encerrado a qualquer momento.</p>
<h2>Privacidade</h2>
<p>O tratamento de dados está descrito na <a href="/privacidade">Política de Privacidade</a>.</p>`,
);

export function registerLegalPages(app: FastifyInstance): void {
  app.get("/privacidade", async (_request, reply) => reply.headers(PAGE_HEADERS).type("text/html; charset=utf-8").send(PRIVACY));
  app.get("/termos", async (_request, reply) => reply.headers(PAGE_HEADERS).type("text/html; charset=utf-8").send(TERMS));
}
