# ADR 0018 — atualização automática do app Windows

Data: 2026-10-24. Estado: aceito pelo usuário em 2026-10-24, aguardando implementação (F07-05).

## Contexto

Hoje cada versão exige baixar e rodar o instalador NSIS na mão. A revisão de segurança de 2026-10-19 vetou o plugin updater porque ele abre um caminho para executar código novo em todos os PCs. Este ADR substitui esse veto por regras que fecham esse caminho.

## Decisão

Usar o `tauri-plugin-updater` oficial do Tauri 2 com o bundle NSIS que já geramos.

Origem: um `latest.json` estático publicado como asset da GitHub Release do projeto, junto do `.exe` e da assinatura. Não há servidor novo nem serviço pago. A origem é a do projeto, não a da instância: todas as instâncias usam o mesmo cliente. Só HTTPS.

Assinatura: par de chaves gerado por `tauri signer generate`. A chave pública vai no `tauri.conf.json`. A privada e a senha ficam apenas como secret do GitHub Actions e numa cópia offline do dono do projeto, nunca no Git, no `.env` ou em log. O app recusa pacote sem assinatura válida e versão igual ou menor que a instalada.

Superfície: a checagem e a instalação rodam no Rust. A webview não recebe as permissões do plugin; recebe só dois comandos próprios, "há atualização?" e "instalar agora", na lista fechada de comandos que já existe.

Comportamento: checa ao abrir e a cada 6 horas. Quando há versão nova, mostra um aviso com a versão e as notas da release. Instala apenas quando o usuário confirma, nunca durante uma chamada. O NSIS roda em modo `passive` e o app reabre sozinho. Sem rede ou com falha, o app segue na versão atual e registra o erro sem dados pessoais.

Release: o workflow de release passa a assinar o instalador e gerar o `latest.json`. Publicar a release continua exigindo ação humana, como hoje.

## Riscos e limites

Quem tiver a chave privada e acesso à Release consegue distribuir código para todos os usuários. Perder a chave obriga a reinstalação manual com uma chave nova. Rotação de chave exige uma versão de transição assinada pela chave antiga.

A assinatura do updater não é assinatura de código do Windows. Sem certificado, o SmartScreen continua avisando na primeira instalação manual; a atualização automática não passa por esse aviso.

Instalação por máquina (pasta Program Files) pede elevação a cada atualização. A instalação atual é por usuário e não pede.

## Prova exigida

Instalar a versão N, publicar N+1 numa release de teste e confirmar: aviso aparece, instalar atualiza e reabre, durante a chamada não instala, pacote com assinatura trocada é recusado, `latest.json` com versão menor é ignorado.
