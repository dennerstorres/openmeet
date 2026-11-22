# OpenMeet Mobile — especificação funcional e limites (F16)

Data: 2026-11-22. Estado: **planejamento, não implementado**. Fonte macro: [SPEC](../SPEC.md); decisão pendente: [ADR 0032](adr/0032-mobile-native.md).

## Objetivo
Entregar apps completos Android/iOS, conectados às instâncias self-hosted OpenMeet existentes, com **câmera, microfone, Bluetooth, chamada com tela bloqueada, compartilhamento da tela do celular e visualização da tela de outros participantes**, além das funções de servidores e mensagens. Sem necessidade de um Mac próprio nem assinatura Apple paga durante desenvolvimento pessoal. **Nenhum recurso listado está considerado comprovado em dispositivo.**

## Personas/jornadas essenciais
1. Usuário instala o app, adiciona URL HTTPS de instância (ou abre convite), verifica origem, autentica com senha/Google quando configurado e escolhe servidor/sala.
2. Entra em voz, liga/desliga mic e câmera, alterna frente/traseira, escolhe Bluetooth ou alto-falante, bloqueia o celular e continua ouvindo/falando.
3. Recebe tela compartilhada do Windows, amplia conteúdo legível, ou compartilha a **tela inteira do próprio dispositivo** com consentimento do sistema e encerramento visível.
4. Durante a chamada, consulta salas e chat (incluindo chat na sala de voz), troca de rede e recebe estado de reconexão sem perder controles.
5. Fora da chamada, administra recursos permitidos pelo papel e recebe notificações quando for tecnicamente/contratualmente possível.

## Paridade de produto (A=Android, I=iOS)
| Grupo | Requisitos de aceite | A | I |
|---|---|---|---|
| Instância/conta | HTTPS, login/sessão por instância, logout, Google se habilitado, deep link e convite seguros | alvo | alvo |
| Servidores | criar/entrar, lista, salas voz/texto, participantes, presença, perfil/avatar, permissões e moderação | alvo | alvo |
| Chat | sala de texto/voz, DM, resposta, menção, reações, busca, anexos/emoji, não lidas | alvo | alvo |
| Chamada | publicar/receber mic, câmera frente/trás, mute, ensurdecer, volume, grade/destaque/fixar, RTC stats | alvo | alvo |
| Áudio | áudio bidirecional com tela bloqueada e em segundo plano, Bluetooth HFP/HSP conforme dispositivo, viva-voz e interrupções | obrigatório | obrigatório |
| Tela recebida | reproduzir o compartilhamento de desktop/outro mobile, legível, ampliar e pin | obrigatório | obrigatório |
| Tela enviada | compartilhar tela inteira fora do OpenMeet, consentimento explícito, indicador e stop | obrigatório | obrigatório |
| Confiabilidade | rede Wi-Fi/celular, BT conecta/desconecta, headset, chamada longa, bateria, restauração, erros visíveis | obrigatório | obrigatório |
| Extras atuais | efeitos de voz, RNNoise/denoise, blur, biblioteca/sons, rádio e áudio da tela onde aplicável | investigar/adaptar | investigar/adaptar |
| Alertas | notificações no app e locais; push remoto Android depende de decisão técnica; push APNs não é objetivo da conta iOS gratuita | parcial/planejar | bloqueado externamente |
| Distribuição | APK interno assinado; iOS desenvolvimento no próprio aparelho com reprovisionamento | alvo | somente desenvolvimento |

"Alvo" não significa PASS; os critérios reais estão em [MOBILE_TEST_MATRIX.md](MOBILE_TEST_MATRIX.md). Nenhuma função de compartilhamento de tela pode ser substituída por screenshot estático ou captura apenas do próprio app.

## Contratos e segurança
- Manter `GET /api/v1/instance`, autenticação/refresh/logout, endpoints de servidor/sala, `POST /api/v1/rooms/:id/join`, SSE e tokens LiveKit; documentar e testar extensões necessárias antes de implementá-las.
- O navegador usa cookies `HttpOnly` e `X-OpenMeet-Web` vinculados à origem. **Mobile não falsifica Origin, não usa cabeçalho web e não desativa CORS/CSRF**; modo nativo autenticado tem que ser revisado para não herdar semântica de `desktop` indevidamente.
- Segredos por instância e tokens no armazenamento nativo seguro, sem salvar em logs/diagnósticos/área de transferência. Revogação da sessão expulsa do LiveKit conforme política atual.
- Login Google via navegador externo com callback/poll seguro; validar redirecionamento sem URL com token, esquema exclusivo e comportamento em app não instalado.
- Permissões solicitadas sob demanda (microfone, câmera, captura); se negadas, UI explica e volta a estado consistente.
- Reutilizar códigos/contratos de erro e garantir isolamento de instâncias. Testes de abuso, autorização, deep link e sessão em background são obrigatórios.

## Requisitos de comportamento
- **Tela bloqueada:** manter áudio/mic e conexão somente durante sessão ativa com o usuário ciente; evitar manter câmera ativa/afirmar captura em background sem suporte comprovado. Ao encerrar a chamada, encerrar serviço/session/audio focus.
- **Bluetooth:** alternar para headset conectado e voltar para alto-falante; diferenciar a qualidade de chamada (HFP) da de música (A2DP), testar microfone do fone e reconfiguração durante chamada. Não prometer seleção arbitrária de saída no iOS.
- **Captura:** Android MediaProjection e iOS ScreenCaptureKit 27+ / ReplayKit extension anterior, com UX de consentimento e interrupção quando o sistema revoga.
- **Conexão:** eventos LiveKit com estado coerente de reconexão; sem inventar garantia de áudio contínuo em todas as políticas de economia de energia ou interrupções de sistema.
- **Qualidade:** preferência por nitidez de texto no screen share; medir resolução/FPS/bitrate/packet loss, não copiar cegamente parâmetros do WebView2.
- **Notificações:** não confundir Web Push/PWA com APNs ou FCM de app nativo; dependências e limitações explícitas.

## Não objetivos desta fase
App Store/TestFlight, distribuição iOS para terceiros sem plano pago, bypass de assinatura/provisionamento Apple, suporte garantido a todos os modelos/versões, gravação/transcrição/E2EE, novos serviços SaaS obrigatórios. Esses limites **não** reduzem o escopo funcional de câmera/tela/áudio.

## Critério de conclusão
Paridade da tabela implementada quando tecnicamente possível, exceções explícitas e aprovadas; [gate G16](../orchestration/QUALITY_GATES.md), teste em **Android físico + iPhone físico**, chamada simultânea com desktop existente, review de segurança e diagnóstico sanitizado. Sem evidência, `WAITING_VALIDATION`.
