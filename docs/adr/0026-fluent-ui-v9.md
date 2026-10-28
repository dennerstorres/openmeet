# ADR 0026 — interface com Fluent UI v9

Data: 2026-10-28. Estado: proposto, pedido pelo usuário em 2026-10-28. Depende de POC antes de qualquer tela migrar.

## Contexto

A UI do desktop e do cliente web é React com CSS próprio: cerca de 9 mil linhas, 3,2 mil delas em `App.css`. O usuário trouxe o kit Fluent do Figma (`docs/Teams UI Kit Libraries/`: Platform Light/Dark/HC, Teams Web & Desktop, Icons, Color, Avatars) e pediu a refatoração da UI com base nele.

O kit é binário do Figma e não serve como código. A implementação oficial desses mesmos tokens e componentes é `@fluentui/react-components` (v9, MIT), com ícones em `@fluentui/react-icons` (MIT).

## Decisão

Adotar Fluent UI v9 como base de componentes e tokens no `apps/desktop`, que também gera o cliente web.

- `FluentProvider` na raiz, com `webLightTheme`, `webDarkTheme` e `teamsHighContrastTheme`, escolhido pelo tema do sistema.
- Componentes do Fluent no lugar dos próprios: botões, menus, diálogos, inputs, abas, tooltips, avatares, toasts.
- Ícones de `@fluentui/react-icons`, importados um a um, substituindo `meeting/Icons.tsx`.
- O CSS próprio fica só para o que o Fluent não cobre: grade de vídeo, tiles e layout da sala (ADR 0009).
- Migração por tela, um PR por tela: shell/consentimento, lista de servidores e salas, sala de reunião, chat e DMs, configurações. Cada PR remove o CSS que deixou de ser usado.

A identidade continua sendo do OpenMeet: nada de nome, logo, ícone de app ou cor de marca do Teams. Os arquivos `.fig` ficam fora do git (`.gitignore`), por tamanho e licença.

## Riscos e limites

**CSP.** O Fluent v9 estiliza com Griffel, que cria `<style>` vazios e põe as regras com `insertRule`. Com `style-src 'self'` (ADR 0005), o Chromium recusa até o `<style>` vazio, e a tela fica sem estilo.

A extração no build (`@griffel/vite-plugin` 1.0.1) só cobre os `makeStyles` do nosso código. Os estilos que vêm pré-compilados no pacote (`__styles`) não são aceitos por ela.

Resultado da POC (2026-10-28): basta liberar o hash do `<style>` vazio, `'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='`. Ele não libera nenhum CSS inline com conteúdo nem atributo `style`; o CSSOM (`insertRule`) não passa pela CSP. Precisa entrar em `tauri.conf.json` e na CSP do cliente web (`apps/server/src/web-client.ts`). É mudança de segurança e exige aprovação humana.

**Tamanho.** O pacote do Fluent é grande; exige import por componente e medir o bundle antes e depois.

**Escopo.** É troca visual, sem feature nova. Comportamento de mídia, permissões e atalhos não mudam.

## Prova exigida

POC numa branch: `FluentProvider` + um `Button`, um `Dialog` e um `Menu` no build de produção do Tauri, com a CSP atual intacta, sem erro de CSP no console, nos três temas. Medir o bundle. Só então migrar a primeira tela, com teste manual no Windows registrado em `HISTORY.md`.
