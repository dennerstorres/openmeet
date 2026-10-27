# ADR 0021 — biblioteca de sons do servidor

Data: 2026-10-26. Estado: aceito pelo usuário em 2026-10-26, após revisão no mesmo dia.

## Decisão

Cada servidor tem uma biblioteca de sons. Todo membro sobe sons, e todo som da biblioteca fica disponível para qualquer membro tocar na sala. Quem toca mistura o som no próprio aparelho, no mesmo `TrackProcessor` do microfone (ADR 0020), e a sala ouve pela faixa do microfone.

O som pertence à conta de quem subiu. Ele nasce só no servidor onde foi enviado. Quem subiu pode importá-lo para outro servidor de que é membro, sem novo upload; o mesmo arquivo passa a constar nas duas bibliotecas.

## Formato e limites

- O cliente aceita qualquer arquivo que o navegador decodifique, sem limite de tamanho na entrada e sem limite de quantidade de sons.
- Antes de enviar, o cliente converte para um formato único: WAV PCM 16 bits, mono, 24 kHz. Esse é o único formato que a API aceita.
- Duração máxima de 20 s. Com o formato fixo, o maior arquivo guardado tem cerca de 940 KB. Esse é o teto técnico: não há limite de tamanho separado.
- A API lê o cabeçalho WAV, confere formato, taxa, canais e tamanho dos dados, e calcula a duração exata. Não confia em extensão, MIME nem duração informada pelo cliente.
- Nome de até 32 caracteres, com a mesma recusa de controle e bidi dos nomes (F10-01).
- Upload limitado por conta e por janela de tempo, como login e bootstrap, para impedir que alguém encha o banco num loop. Sem limite de quantidade total.

## Dados e permissões

Migration nova com `sound` (id, conta dona, nome, duração, bytes, criado em) e `server_sound` (servidor, som, quem adicionou, quando). Os bytes ficam no Postgres, como as imagens (ADR 0019), e entram no backup cifrado existente.

- Ouvir/baixar um som: membro de algum servidor cuja biblioteca o contém.
- Subir: membro do servidor. O som entra só nessa biblioteca.
- Importar para outro servidor: só a conta dona, e só se for membro do destino.
- Tirar um som de uma biblioteca: a conta dona, o dono e os moderadores daquele servidor.
- Apagar o som de vez: só a conta dona; some de todas as bibliotecas.
- Sair do servidor não apaga os sons já enviados para ele.

As rotas novas entram na lista fechada do processo nativo (F10-18) e no cliente web por cookie (ADR 0014).

## Tocar

- Um som por vez: tocar outro corta o anterior. Botão Parar sempre visível enquanto toca. Volume próprio do painel, salvo neste aparelho, separado do volume do microfone.
- O som não recebe o efeito de voz nem o ganho do microfone. Quem toca também ouve localmente, no volume do painel.
- Com o microfone mutado, tocar um som desmuta a faixa com a voz em zero dentro do grafo e volta a mutar quando o som acaba ou é parado. Durante o som, os outros veem o microfone aberto. Sem faixa nova e sem mudança no grant do LiveKit (F10-06).
- Sem microfone publicado (sem permissão ou sem dispositivo), o painel avisa e não toca.
- O cliente guarda em memória os sons já baixados durante a sessão.

## Segurança e privacidade

Sem mudança na CSP: o áudio chega por `fetch` à API já permitida e vira `AudioBuffer`. Bytes de áudio não entram em log nem no diagnóstico exportado. Logs da API registram só ids pseudonimizados.

## Riscos

- Crescimento do Postgres e do backup: sem limite de quantidade, o volume depende do uso. O operador vê o tamanho em `docs/DEPLOYMENT.md`, e o limite de upload por tempo segura abuso automático.
- Conteúdo ofensivo numa biblioteca compartilhada: dono e moderadores removem do servidor; na sala vale o volume local por card e o kick (ADR 0015).
- Som tocado no alto-falante pode voltar pelo microfone se o cancelamento de eco do WebView2 não cobrir o próprio `AudioContext`; exige prova com alto-falante.

## Fora do escopo

Sons padrão no bundle, atalho de teclado por som, fila de sons, aviso na sala de quem tocou, limite de quantidade configurado pelo dono e importar som de outra pessoa.
