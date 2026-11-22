# F16-01/F16-02 — prova de viabilidade iOS sem macOS (xtool)

Data da pesquisa: 2026-11-22. Estado: **NOT_RUN**. Objetivo: obter prova reproduzível, não afirmar compatibilidade.

## Premissas e limites conhecidos
- [xtool](https://github.com/xtool-org/xtool) compila/instala projetos iOS a partir de Linux/Windows com toolchain Swift e SDK Apple obtido legitimamente; a versão `v2.0.0-beta.1` (16-11-2026) acrescentou `.xcodeproj`/`.xcworkspace`, mas avisa que alguns recursos (asset catalogs, storyboards, app intents) **não** funcionam ainda em Linux/WSL.
- Conta Apple gratuita/Personal Team: **até 10 App IDs, 3 dispositivos, 3 apps por dispositivo**; App IDs, registros e perfis expiram em **7 dias**. Exige reprovisionamento/reinstalação. Não há publicação App Store/TestFlight.
- O LiveKit Swift usa Swift Package Manager, mas sua árvore de dependências, binários e requisitos de assinatura **não foram compilados pelo xtool neste repositório**.
- ScreenCaptureKit (iOS 27+) pode evitar a extensão para tela inteira; abaixo disso, a LiveKit Swift recomenda Broadcast Upload Extension e App Group. **Nenhum dos dois caminhos foi validado com conta gratuita + xtool.**
- Não assumir APNs/VoIP Push como disponível gratuitamente; notificações locais não equivalem a chamadas recebidas com app encerrado.

## Ambiente e segurança
- Preferir **Windows + WSL2 Linux** ou Linux nativo, iPhone físico com modo desenvolvedor ativado e cabo USB funcional. Anotar versão do Windows, distro, Swift, xtool, SDK Apple, LiveKit, iOS e modelo.
- Instalar conforme **documentação oficial**, sem scripts de fontes desconhecidas: [xtool Linux/Windows](https://xtool.sh/documentation/xtool/installation-linux/) e [tutorial do primeiro app](https://xtool.sh/tutorials/xtool/first-app/).
- O SDK requer material de desenvolvimento Apple (Xcode SDK); obter de fonte autorizada e respeitar licença de uso. O acesso/cópia é um pré-requisito a verificar; não sugerir origem clandestina.
- Apple ID/2FA/certificados/profiles só na máquina do operador; nunca versionar `xtool.yml` com segredos, token, private keys, provisioning, logs com credenciais nem exportar dados sensíveis para CI público.
- Não executar automaticamente login Apple, upload de certificados ou alterações de conta do usuário; são passos interativos humanos.

## Execução em marcos
| Marco | Ação | Critério de PASS | Estado |
|---|---|---|---|
| X01 | Registrar versões e preparar Swift/xtool/SDK/iPhone | `xtool --version`, Swift/SDK identificados e device detectado | NOT_RUN |
| X02 | SwiftUI Hello World isolado (sem LiveKit) | compilar, assinar via Personal Team e **abrir no iPhone físico** | NOT_RUN |
| X03 | SwiftPM + versão pinada de LiveKit Swift | resolver todos os pacotes/arquiteturas e linkar binários do SDK | NOT_RUN |
| X04 | Minimal `Room` LiveKit contra SFU OpenMeet | conectar, publicar mic, receber outro participante, sair e limpar tracks | NOT_RUN |
| X05 | Áudio com bloqueio e Bluetooth | chamada ativa com tela bloqueada 10 min, BT transmite/recebe, troca de rota | NOT_RUN |
| X06 | Câmera | publicar frente/trás, permissão negada e toggle sem vazamento | NOT_RUN |
| X07 | Tela inteira iOS 27+ | picker ScreenCaptureKit, visualizar outra app remotamente e parar | NOT_RUN |
| X08 | Fallback anterior ao iOS 27 | extensão ReplayKit + App Group assinada/instalada em Personal Team, se houver aparelho | NOT_RUN |
| X09 | Reconexão/distribuição gratuita | reconexão Wi-Fi/celular; reinstalação após perfil expirar documentada | NOT_RUN |

## Comandos de referência (confirmar na versão instalada)
Não é procedimento executado. Consultar `xtool --help`, `xtool dev --help`, tutorial oficial e fixar versão exata antes de usar; flags podem mudar na beta.

```sh
swift --version
xtool --version
xtool --help
xtool dev --help
```

Não adicionar `apps/ios` de produção antes de X02-X04. Criar experimento descartável em branch `task/F16-01-xtool-poc`, sem credenciais. O PoC fica fora do build desktop e não é incorporado automaticamente à release. Para a integração LiveKit, registrar versão e módulos relevantes, eventuais requisitos de APIs nativas indisponíveis e erros completos **sanitizados**.

## Resultado e tomada de decisão
- **GO infraestrutura**: X02-X04 PASS em iPhone, com evidências, revisão do método de assinatura e artefato reproduzível (sem secretos). Isso libera scaffolding iOS F16-06; não prova X05-X09.
- **GO mídia avançada**: X05-X07 PASS; X08 depende de disponibilidade de SO anterior/entitlement e, se não testável, mantém restrição explícita por versão. NÃO declarar suporte a todos os iPhones.
- **NO-GO**: dependência LiveKit não linka, app não instala com Personal Team, capacidades exigem assinatura indisponível, ou chamada não funciona com runtime nativo. Abrir bloqueio com versão/erro/reprodução; reavaliar stack sem ocultar custo.
- **WAITING_VALIDATION**: testes físicos indisponíveis, dependências compiladas sem executar em iPhone, ou captura não verificada.
- Responsável pelas ações Apple/iPhone: humano. Revisões: Claude arquitetura/segurança, Codex testes/reprodução.

## Modelo de registro de evidência
```text
ID: X__
Data: YYYY-MM-DD
Host: Windows __ / WSL distro __ / Linux __
Swift: __    xtool: __    iOS SDK: __
LiveKit Swift: __    iPhone/iOS: __
Instância/SFU de teste: identificador não sensível
Comandos: __
Resultado: PASS | FAIL | NOT_RUN
Evidência sanitizada: caminho/ID do log ou vídeo + observação
Impedimento / próximo experimento: __
```

## Referências
- https://github.com/xtool-org/xtool/releases
- https://xtool.sh/documentation/xtool/installation-linux/
- https://xtool.sh/tutorials/xtool/first-app/
- https://developer.apple.com/help/account/basics/about-your-developer-account
- https://developer.apple.com/help/account/reference/supported-capabilities-ios
- https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md
- https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios
