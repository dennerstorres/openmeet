# Arquitetura proposta — OpenMeet Mobile F16

Data: 2026-11-22. Estado: **proposta condicionada ao ADR 0032**. Não há código mobile validado.

## Diagrama de componentes

```text
 apps/android/ (Kotlin / Compose)      apps/ios/ (Swift / SwiftUI)
       |                                        |
 API adapter / sessão nativa             API adapter / sessão nativa
       |                                        |
 LiveKit Android SDK                      LiveKit Swift SDK
       +--------------+-------------------------+
                      | HTTPS API + WSS/WebRTC
         apps/server/ (Fastify, PostgreSQL)
             |                  |
       auth/chat/salas     tokens e política
                                |
                        LiveKit SFU/TURN
 apps/desktop/ + web continuam como clientes da mesma instância
```

## Reaproveitamento concreto
| Origem atual | Reuso | Ação |
|---|---|---|
| `apps/server` | Alto | manter API/autorização; mudar só contratos mobile necessários, com compatibilidade |
| `packages/shared` | Sem importação direta nativa | produzir fixtures JSON e testes de contrato entre TS, Kotlin e Swift |
| `packages/media` | Regras como referência, não código multiplataforma | mapear modos/diagnósticos do LiveKit JS para SDKs nativos |
| `apps/desktop/src/meeting` | UX e requisitos | implementar telas Compose/SwiftUI; não copiar plugins Tauri |
| `apps/desktop/src/web/session.ts` | NÃO reutilizar | cookies/Origin são exclusivos da página da instância |
| `apps/desktop/src/shell/native.ts` | NÃO reutilizar | keyring/tray/atalhos/updater Windows são específicos |
| `infra/compose` | Reuso integral | LiveKit/TURN e API; teste com redes móveis reais |

## Layout sugerido (somente após GO)
```text
apps/
  android/          # Gradle, app Compose, UI, data/api, auth, call, chat, media
  ios/              # SwiftPM/xtool.yml OU Xcode project validado, UI, api, auth, call, chat, media
docs/
  MOBILE_SPEC.md
  MOBILE_ARCHITECTURE.md
  MOBILE_IOS_XTOOL.md
  MOBILE_TEST_MATRIX.md
plans/
  phase-16-mobile.md
```

## Fronteiras e contratos
- **API**: `InstanceClient` (URL HTTPS fixada por perfil), `AuthSession`, `ServersRooms`, `ChatEvents`, `MediaJoinToken`. Não derivar URL do LiveKit de input do usuário nem misturar tokens de instâncias.
- **Sessão**: cada instância tem refresh isolado, rotativo; logout revoga família e encerra chamada. Token de acesso em memória, refresh no cofre Android/iOS; armazenamento seguro depende de revisão e prova em aparelho, inclusive restauração/reinstalação.
- **Chat realtime**: SSE com reconexão e `Last-Event-ID` onde previsto; reconciliação no retorno da suspensão; não depender de execução arbitrária em background.
- **Mídia**: `CallSession` encapsula connect/disconnect, publicações, device routing, eventos, stats e estados; LiveKit decide fluxo SFU. Só publicar áudio de tela/rádio se grant e SDK permitirem.
- **UI**: ViewModels/state holders adaptados ao ciclo de vida, sem lógica de autorização no frontend; estados `idle -> connecting -> connected -> reconnecting -> disconnected`. Guards para ações assíncronas repetidas.
- **Presença**: não transformar presença efêmera em estado durável da DB.

## Android — requisitos de plataforma
- Gradle/AGP/Kotlin fixados no bootstrap (não presumir versões). SDK `io.livekit:livekit-android` conforme documentação pinada.
- `RECORD_AUDIO`, `CAMERA`, permissões de notificação/serviços conforme target SDK e versão; foreground service apropriado a `microphone`/`camera`/`mediaProjection` e sua política.
- `AudioManager`/`setCommunicationDevice` ou SDK equivalente; teste BT SCO/HFP, A2DP, alto-falante, USB e interrupções de áudio.
- MediaProjection com permissão do usuário, sessão/transporte ligado ao ciclo de vida e stop na revogação.
- App lock/background: serviço iniciado legitimamente pela interação do usuário, notificação persistente, limpeza no hangup. Validar restrições específicas por versão/fabricante.

## iOS — requisitos de plataforma
- SwiftUI + LiveKit Swift, integração com `AVAudioSession` e configuração de `UIBackgroundModes` adequada; evento de interrupção/rota/telefonia com teste real.
- Bluetooth usando rotas do sistema e `AVRoutePickerView` quando aplicável; não forçar seleção que a plataforma não permite.
- iOS 27+: ScreenCaptureKit via LiveKit quando disponível, com picker e background mode `screen-capture`; versões anteriores: ReplayKit Broadcast Upload Extension e App Group, dependentes de build/provisionamento compatíveis.
- Testar `Background Modes`, App Group, framework binário/XCFramework e extensões no **xtool** antes de incluir esses recursos no app principal. Não inferir suporte só porque `swift build` passou.
- Push APNs, TestFlight e App Store ficam bloqueados sem Apple Developer Program; preferir estados e mensagens claras.

## Compatibilidade e teste
- Mesmo usuário em desktop e mobile: sessão por aparelho, multi-login, logout seletivo, emissão de token e entrada simultânea na sala.
- Smoke em rede local e externa; TURN; 5 participantes/60 minutos; tela bloqueada >= 10 minutos; BT conectando/desconectando; câmera liga/desliga; compartilhamento próprio e remoto; saída/entrada de chamada telefônica.
- Não declarar compatibilidade com versões de SO ainda não testadas. Arquivos de teste e critérios em `MOBILE_TEST_MATRIX.md`.

## Caminhos alternativos
Se F16-02 for NO-GO por xtool, manter cliente Android e contratos implementáveis, registrar problema e avaliar outra cadeia de build iOS **sem exigir compra de Mac ou conta paga para desenvolvimento**; não mudar para WebView por conveniência e afirmar que atende background/Bluetooth. Qualquer troca de stack precisa de ADR aditivo.
