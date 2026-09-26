# Ticketx Bot

Bot independente de tickets multi-servidor em TypeScript e discord.js, configurado por uma central visual no Discord. Painéis, mensagens internas e logs usam Components V2 nativos do Discord.

## Recursos

- Múltiplos painéis independentes por servidor, com botões ou menu de seleção.
- Título, descrição, cor, banner, miniatura, rodapé e canal configuráveis.
- Múltiplas categorias por painel, equipes por cargo, acesso restrito por cargo, estilo de botão e limite por usuário.
- Formulários com até cinco perguntas personalizáveis.
- Abertura, claim, unclaim, fechamento, reabertura, participantes, renomeação e exclusão.
- Transcrições HTML locais, sem serviço externo.
- Logs de auditoria e estatísticas por servidor.
- Persistência SQLite transacional em WAL e isolamento por servidor.
- Apenas a intent `Guilds`; nenhuma intent privilegiada é necessária.
- Funciona somente com o bot Discord e SQLite, sem login de usuários, bridge ou API de site.

## Requisitos

- Node.js 20 ou superior.
- Uma aplicação no Discord Developer Portal com bot criado.
- Permissões para gerenciar canais, visualizar canais, enviar/gerenciar mensagens, ler histórico e anexar arquivos.

## Instalação

```bash
npm ci
copy .env.example .env
npm run check
npm run deploy
npm start
```

Configure `.env`:

```dotenv
DISCORD_TOKEN=token_regenerado_do_bot
CLIENT_ID=id_da_aplicacao
GUILD_ID=id_do_servidor_de_testes
GLOBAL_COMMANDS=false
DATABASE_PATH=./data/tickets.db
LOG_LEVEL=info
```

Nunca versione `.env`. Se um token aparecer em chat, log ou commit, regenere-o no Developer Portal antes de produção.

Para disponibilizar o bot em todos os servidores onde ele for instalado, defina `GLOBAL_COMMANDS=true`, remova a necessidade de `GUILD_ID` e execute `npm run deploy`. Use `/configurar convite` para obter o link de instalação com os escopos e permissões corretos.

## Configuração inicial pelo Discord

1. Execute `/admin` para abrir a central privada.
2. Em **Servidor**, defina logs, transcrições, cor e cargos administrativos.
3. Em **Painéis**, crie ou selecione um painel e ajuste aparência, rota e categorias.
4. Use **Publicar** após alterações para atualizar a mensagem que os membros veem.
5. Se desejar um único ponto de entrada no canal da equipe, execute `/admin-instalar canal:#gestão` uma vez.

Os comandos antigos continuam disponíveis como fallback. Alterações estruturais no painel exigem publicação novamente; o bot edita a mensagem existente quando ela ainda existe.

## Comandos

- `/admin`: abre a central administrativa visual, privada e navegável.
- `/admin-instalar`: publica o launcher da central em um canal administrativo.
- `/configurar`, `/painel`, `/categoria` e `/formulario`: compatibilidade e automação avançada por slash command.
- `/ticket`: info, estatísticas, fechar, reabrir, reivindicar, liberar, participantes, renomear e transcript.

A autorização é revalidada no servidor em cada interação; esconder um comando no cliente não é tratado como controle de segurança.

## Central administrativa

A central guarda apenas um ID de sessão nos componentes; servidor, administrador, painel selecionado e tela atual ficam no processo e expiram após 10 minutos. Toda interação revalida a autorização. Isso impede reutilização de um botão por outro usuário e mantém os `custom_id` dentro do limite do Discord.

A mensagem publicada por `/admin-instalar` é apenas um launcher estático. Cada administrador que a aciona recebe a própria console efêmera, portanto uma reinicialização do bot nunca deixa ações administrativas antigas válidas.

## Qualidade e auditoria

```bash
npm run check       # lint + testes + compilação
npm run smoke       # autentica e valida conexão sem alterar o servidor
npm run audit:live  # ensaio E2E temporário com limpeza automática
npm audit           # vulnerabilidades das dependências
```

`audit:live` cria canais privados temporários, executa o ciclo completo e os exclui. Ele deixa somente entradas no Audit Log do Discord.

## Dados, backup e escala

O banco padrão é `data/tickets.db`. Em hospedagens como Square Cloud, mantenha `data/` em armazenamento persistente. Para backup consistente, pare o bot e copie o arquivo `.db` junto com eventuais arquivos `.db-wal` e `.db-shm`.

SQLite WAL atende bem uma instância e muitos servidores pequenos/médios. Ao se aproximar de sharding ou múltiplas instâncias, migre o repositório para PostgreSQL e adicione um coordenador distribuído. Acima de aproximadamente 2.500 servidores, o Discord exige sharding.

## Referências de projeto

- [Components V2 oficiais](https://docs.discord.com/developers/components/using-message-components)
- [Interações e respostas](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Permissões do Discord](https://docs.discord.com/developers/topics/permissions)
- [Instalação de apps](https://docs.discord.com/developers/resources/application)
- [Painéis do TicketsBot](https://docs.tickets.bot/dashboard/ticket-panels)
- [Recursos do TicketsBot](https://docs.tickets.bot/features/introduction)

Veja também [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
