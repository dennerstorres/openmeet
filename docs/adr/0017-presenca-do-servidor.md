# ADR 0017 — presença dos membros do servidor

Data: 2026-10-23. Estado: aceito pelo usuário, aguardando validação manual.

## Decisão

Cada servidor lista todos os membros ativos, mesmo fora de uma sala. A presença da plataforma não reutiliza a presença de sala do LiveKit: clientes autenticados enviam heartbeat para todos os servidores dos quais participam. A API mantém em memória apenas o último estado e horário. Heartbeat ativo é `online`; janela oculta ou cinco minutos sem interação é `away`; ausência por mais de 75 segundos é `offline`.

O banco guarda duas opções do servidor (`allow_invisible`, `managers_see_invisible`) e a preferência do membro (`visible` ou `invisible`). Só o dono altera a política. Se invisibilidade estiver proibida, todos os modos voltam a visível. Quando permitida, um invisível aparece `offline` aos membros comuns. Se a segunda opção estiver ligada, dono e moderadores recebem `invisible` e, quando presente, sua atividade online/away. O próprio usuário sempre reconhece seu modo.

## Limites

Estado online não é persistido nem auditado. Reiniciar a API deixa todos offline até o próximo heartbeat. O desenho assume a implantação de um nó já definida; múltiplos nós exigiriam armazenamento efêmero compartilhado e continuam fora do MVP. Fechar ou perder a rede pode levar até 75 segundos para aparecer offline. Logout explícito remove a presença imediatamente.
