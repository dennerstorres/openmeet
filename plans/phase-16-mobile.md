# Fase 16 — OpenMeet Mobile nativo (Android + iOS)

Criada: 2026-11-22. Estado: **PLANEJADA / provas NOT_RUN**. Decisão estrutural: [ADR 0032 PROPOSTO](../docs/adr/0032-mobile-native.md). A existência deste plano **não** significa build, APK, IPA, GO ou release.

## Objetivo e restrições
- App completo em ambas plataformas: contas/instâncias, servidores, chat/DM, chamadas com câmera, Bluetooth, áudio com tela bloqueada, envio da tela inteira e recepção de compartilhamentos, com paridade explícita e validação real.
- **Sem Mac próprio, sem Apple Developer Program pago.** Android gera APK; iOS só build/instalação pessoal de desenvolvimento se xtool + dependências + assinatura gratuita funcionarem (prova técnica primeiro). Sem App Store, TestFlight ou APNs agora.
- Preservar Windows, web, backend existente, TLS/CORS/CSRF/refresh, isolamento por instância e distribuição self-hosted. Sem serviço SaaS pago obrigatório; não fingir que push nativo é gratuito no iOS.
- Duas UIs nativas independentes conforme ADR; contratos JSON/API comuns, não cópia literal de `packages/shared` ou `packages/media`.
- Uma tarefa/branch com revisão e evidências, conforme `AGENTS.md` e `orchestration/WORKFLOW.md`.

## Artefatos vinculados
- `docs/MOBILE_SPEC.md`: escopo/funcionalidades e limites.
- `docs/MOBILE_ARCHITECTURE.md`: módulos, contratos, segurança e lifecycle.
- `docs/MOBILE_IOS_XTOOL.md`: protocolo técnico X01-X09 e GO/NO-GO.
- `docs/MOBILE_TEST_MATRIX.md`: testes reais A/I/X com estado inicial NOT_RUN.
- `docs/adr/0032-mobile-native.md`: decisão arquitetural ainda aguardando aceite.
- `orchestration/QUALITY_GATES.md`: G16.

## Sequência executável
| ID | Entrega verificável | Depende de | Status | Responsável inicial | Gates |
|---|---|---|---|---|---|
| F16-00 | Aceitar/ajustar ADR 0032 e matriz de compatibilidade | — | WAITING_VALIDATION | Humano + Claude review | G16 |
| F16-01 | POC xtool SwiftUI Hello no iPhone com Personal Team, versões e assinatura | — | READY | Grok + humano para device/Apple ID | G16 |
| F16-02 | POC **LiveKit Swift via xtool**: build/link, sala real, áudio/BT/background e avaliar captura | F16-01 | PENDING | Grok + humano | G16 |
| F16-03 | Inventário API/contratos e fixtures para Kotlin/Swift, sem alterar servidor | F16-00 | PENDING | Grok + Codex review | G3,G16 |
| F16-04 | Contrato e implementação de sessão nativa, Google/link, identificação do tipo mobile e testes de segurança | F16-03 | PENDING | Grok + Claude review | G3,G10,G16 |
| F16-05 | Scaffold Android Kotlin/Compose, build APK e rotas/telas base | F16-00,F16-03 | PENDING | Grok | G1,G16 |
| F16-06 | Scaffold iOS SwiftUI e pipeline xtool reproduzível | F16-00,F16-02 | PENDING | Grok | G1,G16 |
| F16-07 | UI Android/iOS de conta, servidor, sala, perfis e convites | F16-04,F16-05,F16-06 | PENDING | Grok | G9,G16 |
| F16-08 | CallSession Android LiveKit: áudio/vídeo, grid, estados, câmera e recepção de tela | F16-04,F16-05 | PENDING | Grok | G4,G16 |
| F16-09 | CallSession iOS LiveKit: áudio/vídeo, grid, estados, câmera e recepção de tela | F16-04,F16-06 | PENDING | Grok | G4,G16 |
| F16-10 | Audio background + Bluetooth + interrupções, Android e iOS | F16-08,F16-09 | PENDING | Grok + humano | G16 |
| F16-11 | Compartilhamento de tela Android MediaProjection e stop | F16-08 | PENDING | Grok + humano | G16 |
| F16-12 | Compartilhamento iOS ScreenCaptureKit 27+ e ReplayKit anterior quando viável | F16-02,F16-09 | PENDING | Grok + humano | G16 |
| F16-13 | Chat/DM/presença/anexos e paridade de recursos avançados (efeitos, sons, blur, rádio) | F16-07,F16-08,F16-09 | PENDING | Grok + Codex review | G4,G9,G16 |
| F16-14 | Notificações e estratégia push por plataforma/conta; tratamento explícito de bloqueios | F16-13 | PENDING | Grok + Claude review | G10,G16 |
| F16-15 | Testes segurança/RTC/BT/bloqueio/tela/60 min, diagnósticos e review independente | F16-10,F16-11,F16-12,F16-13,F16-14 | PENDING | Humano + Codex/Claude | G3,G4,G16 |
| F16-16 | Packaging Android, procedimento iOS gratuito e documentação de limitações/releases | F16-15 | PENDING | Grok + humano | G7,G16 |

## Regras de avanço
1. **F16-01 é a primeira tarefa técnica READY** (segura e independente); não precisa de aprovação do ADR para um experimento isolado. **F16-02 só depois X02 em iPhone**. Não começar F16-06 até F16-02 demonstrar GO infraestrutura.
2. Nenhum código de produção Android/iOS antes de F16-00. O ADR é PROPOSTO até aceite explícito; planejar não equivale a aceitar.
3. NO-GO xtool bloqueia F16-06/F16-09/F16-12, **não** bloqueia a preparação de contratos nem Android após ADR aceito. Publicar erro e opções, sem trocar de stack silenciosamente.
4. F16-10, F16-11 e F16-12 podem executar em branches separadas assim que cada backend mobile estiver pronto; a tabela agrega gates finais, não obriga esperar Android para toda tarefa iOS fora do que está explicitado.
5. Status `IMPLEMENTED` exige código/testes estáticos; teste humano ausente -> `WAITING_VALIDATION`, nunca `DONE`. F16-16 não promete distribuição iOS normal sem assinatura paga.
6. Sem credenciais/certificados/logs identificáveis no GitHub; instalação no aparelho e conta Apple são ações humanas.

## Definição de pronto
Todos os critérios aplicáveis de `docs/MOBILE_TEST_MATRIX.md` PASS, exceções plataforma/conta documentadas e aceitas, nenhum P0/P1 aberto, testes de autorização e regressão desktop/web, assinatura Android e roteiro de instalação iOS gratuitos. Gate G16 e revisão independente completos. O usuário **não** aceita uma PWA como substituto de áudio de background/BT/captura integral.

## Primeiro handoff sugerido (Codex/Claude/Grok)
> Ler AGENTS.md, SPEC.md, PLAN.md, ADR 0032, MOBILE_IOS_XTOOL.md e esta fase. Executar **somente F16-01** em branch própria. Não instalar dependências sem registrar versões. Não coletar credenciais Apple no repositório. Registrar X01/X02 e comandos reproduzíveis; se não houver iPhone físico/Apple ID disponível, marcar WAITING_VALIDATION/NOT_RUN e produzir roteiro humano. Não declarar GO sem app instalado e aberto no aparelho. Atualizar HISTORY/PLAN/matriz com evidência real.
