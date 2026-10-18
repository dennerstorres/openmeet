# ADR 0003 — Contas independentes por instância
Status: Accepted.

Decisão: uma implantação é uma instância/realm. Sem conta global nem multi-tenancy no backend. Desktop armazena múltiplas configurações de servidor, cada uma com login e token isolados.

Evitar misturar sessão de instância A com domínio B. Convites e tokens só têm validade na instância emissora. Sem federação na versão 1.
