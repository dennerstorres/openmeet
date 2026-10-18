# Política de testes do executor Grok

Criar unit/component/API tests para lógica determinística; E2E automatizado se aplicável. Para WebRTC usar ambos testes automatizados (estado, controle, mocks) e teste manual real (captura, áudio, rede, dispositivos). Registrar falhas e comandos com códigos de saída.

Nunca chamar teste manual de PASS sem ambiente real e evidência. Redigir roteiro para humano e mover tarefa para WAITING_VALIDATION.
