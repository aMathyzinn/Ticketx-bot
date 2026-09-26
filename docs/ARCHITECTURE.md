# Arquitetura

## Fluxo

1. O administrador abre `/admin` ou o launcher administrativo; a console Components V2 guia servidor, painéis, categorias e formulários. Slash commands continuam como fallback.
2. O repositório grava cada entidade com `guild_id` em SQLite.
3. Painéis e console carregam somente IDs curtos no `custom_id`; nenhum estado de autorização é confiado ao cliente. A console mantém sessão efêmera por administrador, servidor e tela, com expiração de 10 minutos.
4. Ao abrir um ticket, uma transação reserva o número e aplica o limite do usuário antes da criação do canal.
5. O canal recebe overwrites explícitos para bot, autor e cargos de atendimento.
6. Cada ação recarrega ticket/categoria do banco, confirma servidor/canal e revalida autorização.
7. Fechamento arquiva a transcrição, bloqueia escrita do autor e preserva o canal para reabertura ou exclusão por staff.

## Módulos

- `src/config`: validação de ambiente.
- `src/database`: schema, transações e consultas multi-tenant.
- `src/domain`: modelos e normalização.
- `src/services`: regras de autorização, tickets, transcrições, publicação de painéis e controle da console administrativa.
- `src/ui`: payloads Components V2, incluindo a console administrativa.
- `src/commands`: superfície administrativa e operacional.
- `src/events`: roteamento de comandos, componentes e modais.
- `src/scripts`: deploy, smoke test e auditoria real.

## Garantias

- Segredos permanecem apenas em `.env`.
- O banco impede ultrapassar o limite de tickets mesmo com cliques concorrentes.
- Todas as consultas operacionais são escopadas por servidor.
- Claim é exclusivo de staff e unclaim exige o responsável ou administrador.
- Fechamento respeita `allowUserClose`; reabertura e exclusão são exclusivas da equipe.
- Menções são controladas com `allowedMentions`.
- Falhas de log/transcrição são registradas sem corromper o ticket.
- A console revalida cargo administrativo em cada botão, menu e modal; sessões expiradas falham fechadas.

## Evolução

Para escala horizontal, crie uma interface de repositório equivalente a `TicketRepository`, implemente-a em PostgreSQL e execute shards separados.
