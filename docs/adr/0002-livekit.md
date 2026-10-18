# ADR 0002 — LiveKit SFU
Status: Accepted for POC.

Decisão: LiveKit self-hosted para signaling e mídia WebRTC. Backend só controla identidade/rooms e emite tokens. Alternativas: mediasoup (maior customização e trabalho), Janus, P2P mesh (escala ruim em grupo).

Riscos: rede externa/TURN, custo de egress e complexidade de deploy. Testes obrigatórios G2 incluem duas redes reais, limite NAT e reconexão.
