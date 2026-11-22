# ADR 0032 — clientes móveis nativos Android/iOS (PROPOSTO)

Data: 2026-11-22. Estado: **PROPOSTO, aguarda aceite explícito**. Referências: [SPEC](../MOBILE_SPEC.md), [arquitetura](../MOBILE_ARCHITECTURE.md), [fase 16](../../plans/phase-16-mobile.md).

## Contexto e requisitos inegociáveis
O OpenMeet oferece clientes Windows (Tauri/WebView2) e web/PWA sobre a API Fastify, PostgreSQL e LiveKit self-hosted. O usuário solicita apps **Android e iOS completos**, com microfone, câmera, compartilhamento de tela, fones Bluetooth e continuidade de chamada com a tela bloqueada, sem Mac próprio nem Apple Developer Program pago neste momento.

A UI web/desktop e `packages/media` dependem de APIs de navegador; empacotar a página em uma WebView não resolve os requisitos de áudio de fundo, roteamento Bluetooth e captura de tela em ambos os sistemas.

## Decisão proposta
1. Clientes **nativos separados** em `apps/android` (Kotlin + Jetpack Compose + SDK LiveKit Android) e `apps/ios` (Swift + SwiftUI + SDK LiveKit Swift), preservando `apps/desktop` e o cliente web.
2. O servidor existente continua sendo a fonte de identidade, autorização, salas, chat e emissão de tokens LiveKit. Nada de segundo backend nem conta global.
3. Compartilhar **contratos** HTTP/eventos e regras por especificação/testes de contrato; **não** prometer importação direta dos pacotes TypeScript para Kotlin/Swift.
4. Segurança nativa: HTTPS/WSS, armazenamento de refresh token em Android Keystore/Encrypted Storage ou equivalente revisado e iOS Keychain, access token de vida curta em memória; nunca usar cookie web ou `X-OpenMeet-Web` como atalho para a autenticação mobile. Revalidar as regras existentes de origem e token.
5. Áudio em background e Bluetooth são caminhos nativos: Android foreground service com tipo/permissões apropriados ao alvo, notificações da sessão ativa e gerenciamento de dispositivos de comunicação; iOS `AVAudioSession` (playAndRecord, modos e opções de rota) e background audio. CallKit/telecom são integrações condicionais, não bypass para execução ilimitada.
6. Tela mobile: Android MediaProjection com consentimento por sessão, foreground service de tipo adequado e encerramento explícito; iOS 27+ avaliar ScreenCaptureKit do LiveKit e seu background mode; em versões anteriores, Broadcast Upload Extension/ReplayKit + App Group quando o provisionamento permitir. Captura apenas do próprio app não satisfaz "tela inteira".
7. iOS sem Mac: usar **xtool + Linux/WSL2** como caminho de desenvolvimento condicionado a provas. Conta Apple gratuita/Personal Team só para testes nos dispositivos autorizados, com expiração de provisioning; não prometer App Store/TestFlight, APNs ou distribuição contínua gratuita.
8. Implementação por tarefas pequenas, com matrizes reais e gates. Efeitos de voz, blur, rádio, compartilhamento de áudio da tela e notificações exigem análise de viabilidade/permissões específica; nada de reduzir silenciosamente o escopo.
9. Nenhuma dependência de serviço pago/SaaS obrigatório. Push do sistema com app encerrado exige decisão específica: APNs não está disponível nesse cenário gratuito; Android pode requerer infraestrutura de entrega externa opcional. Mensagens dentro do app, polling ativo e notificações locais não devem ser descritos como push remoto equivalente.

## Alternativas avaliadas
- **PWA:** disponível, útil como fallback, mas não atende de maneira confiável às chamadas com tela bloqueada, mídia nativa e tela completa.
- **Tauri 2 mobile + xtool:** reaproveita React, mas depende da maturidade da camada de mídia e dos plugins em iOS; pode ser reavaliado após provas comparáveis, não é base aprovada.
- **Capacitor:** acelera a UI, não elimina bridging nativo complexo de mídia.
- **React Native + Expo/EAS:** SDK LiveKit viável, mas o pipeline iOS/assinatura sem Apple Developer pago não foi comprovado para este projeto; manter como alternativa de contingência documentada, sem prometer custo zero.
- **Kotlin Multiplatform:** acrescenta integração/build não necessários antes da prova iOS.

## Consequências e riscos
- Duas interfaces e dois SDKs de mídia, mais esforço de manutenção; compensa pela previsibilidade da integração com o sistema.
- Mudanças de API devem ser compatíveis com versões existentes de desktop/web, com testes negativos, sem desativar CORS, CSRF ou TLS.
- **NO-GO obrigatório:** se xtool não conseguir compilar, assinar e instalar em iPhone físico um POC LiveKit com as dependências exigidas, registrar logs sanitizados, versão exata e impedimento; não iniciar o cliente iOS completo baseado em hipótese. A execução Android e o desenho compartilhado podem seguir separadamente.
- A viabilidade de extensão ReplayKit com conta gratuita, App Groups, ScreenCaptureKit em iOS 27 e background audio será provada em aparelho real, nunca inferida da documentação.
- Suporte mínimo de versões de Android/iOS será definido por matriz de compatibilidade e testes; iOS 27+ não representa automaticamente todos os usuários.

## Critérios para aceitar este ADR
O usuário aprova a decisão de duas UIs nativas e o plano de manutenção; a F16-01 identifica ferramenta/SDK; a F16-02 comprova ou nega o caminho sem macOS. **Este documento não declara GO técnico.**

## Referências verificadas em 2026-11-22
- [xtool — releases](https://github.com/xtool-org/xtool/releases), beta 2.0.0-beta.1 com `.xcodeproj`/`.xcworkspace` e limitações Linux/WSL.
- [xtool — instalação Linux/Windows](https://xtool.sh/documentation/xtool/installation-linux/) e [primeiro app](https://xtool.sh/tutorials/xtool/first-app/).
- [LiveKit Swift — compartilhamento iOS](https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md).
- [Apple — conta gratuita](https://developer.apple.com/help/account/basics/about-your-developer-account) e [capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios).
