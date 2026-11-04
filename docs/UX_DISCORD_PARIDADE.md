# Paridade de posição com o Discord

Objetivo: quem vem do Discord acha cada controle no mesmo lugar. Não é design, é **posição**.
Fonte: Discord desktop 1.0.9266 (observado em 04/11/2026) × `apps/desktop/src/meeting/MeetingApp.tsx`.

## Já igual

| Área | Discord | OpenMeet |
|---|---|---|
| Barra de servidores | coluna fina à esquerda, DMs no topo, "+" embaixo | `server-bar` igual |
| Lista de canais | 2ª coluna, nome do servidor no topo com engrenagem | `room-bar` + `room-bar-head` igual |
| Usuários na sala de voz | aparecem embaixo do canal | `occupants` igual |
| Painel "Voz conectada" | acima da conta, com sinal e botão desligar | `voice-panel` igual |
| Rodapé da conta | avatar · nome · mic · fone · engrenagem | `footer.account` igual |
| Membros | coluna à direita | `members-panel` igual |

## Diferente (corrigir)

1. **Painel de sons fora do lugar.** Discord: botão Soundboard na linha do `voice-panel`
   (Câmera · Tela · Atividades · Soundboard). OpenMeet: `SoundPanel` só no dock da chamada
   (linha ~2290) e some em tela cheia. → Pôr botão de sons no `voice-panel` (linha ~1384),
   ao lado de Câmera/Tela; o dock pode manter.
2. **Mic e fone somem fora da chamada.** Discord mostra sempre (dá pra entrar já mutado).
   OpenMeet só renderiza com `inCall` (linha ~1409). → Mostrar sempre e lembrar o estado
   ao entrar.
3. **Engrenagem abre menu, não configurações.** Discord: engrenagem = Configurações de
   usuário direto; perfil/status = clique no avatar/nome. OpenMeet: engrenagem abre menu
   "Conta". → Engrenagem abre Configurações; avatar/nome abre menu (Perfil, status, sair).
4. **Seta ao lado de mic e fone.** Discord tem `˅` pra trocar dispositivo de entrada/saída.
   OpenMeet esconde isso em "Dispositivos e diagnóstico" no dock. → Setinha no rodapé.
5. **Ordem do dock da chamada.** Discord (centro, embaixo): Mic · Câmera | Tela · Atividades/
   Sons | Desligar (vermelho). Dispositivos ficam na seta do mic/câmera, não em botão à parte.
   Qualidade da tela e "som do PC" ficam no diálogo de iniciar compartilhamento, não no dock.
6. **Chat da sala de voz.** Discord: ícone de balão no canto superior direito da chamada abre
   o chat do canal ao lado. → Conferir se existe; se não, entra como item de SPEC.
7. **Layout/cards por tela.** Discord deixa isso em ícones no canto superior direito da
   chamada, não como segmentado no cabeçalho. Baixa prioridade.

## Observado dentro da sala de voz (04/11/2026)

- **Painel "Voz conectada"** (acima da conta): título verde + "Sala / Servidor", ícone de
  supressão de ruído e desligar à direita; embaixo 4 botões iguais: Câmera · Tela ·
  Atividades · **Soundboard**.
- **Canal na lista**: ao passar o mouse, ícones de chat 💬 e convidar ao lado do nome;
  timer da chamada aparece no lugar; participantes listados embaixo.
- **Tela da chamada**: topo = nome da sala à esquerda, balão de chat no canto direito.
  Rodapé central em 3 grupos: [Mic ˅ · Câmera] [Atividades · Soundboard · ⋯] [Desligar vermelho].
  Rodapé esquerdo: convidar. Rodapé direito: janela destacada e tela cheia.
- **Seta do mic**: dispositivo de entrada, perfil (isolamento de voz), dispositivo de saída,
  volume de entrada, nível, volume de saída, "Desativar áudio", atalho p/ Configurações de voz.
- **Menu ⋯**: Convidar, exibição em grade, mostrar própria câmera, mostrar quem está sem vídeo,
  prévia de mensagens, Configurações de voz e vídeo. → Nosso segmentado "Destaque/cards"
  deveria morar aqui.

## Estado

Itens 1–5 e 7 implementados na branch `task/discord-paridade-1-4` (WAITING_VALIDATION: falta teste manual no app).
Item 6 BLOCKED até aceitar o ADR 0031 (proposto).

## Prioridade sugerida
1 (sons) → 2 (mic/fone sempre) → 3 (engrenagem) → 4 (setas) → 5 → 6 → 7.
Itens 1–4 são só reposicionamento em `MeetingApp.tsx`; 6 pode precisar de SPEC/ADR.
