import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { GuildSettings, Panel, TicketCategory, TicketQuestion } from '../domain/models';
import { AdminConsoleSession } from '../services/AdminConsoleStore';
import { V2Message } from './components';

const PAGE_SIZE = 25;

function color(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
}

function cid(session: AdminConsoleSession, action: string): string {
  return `ac:${session.id}:${action}`;
}

function button(session: AdminConsoleSession, action: string, label: string, style = ButtonStyle.Secondary, emoji?: string): ButtonBuilder {
  const value = new ButtonBuilder().setCustomId(cid(session, action)).setLabel(label).setStyle(style);
  if (emoji) value.setEmoji(emoji);
  return value;
}

function container(settings: GuildSettings, title: string, description?: string): ContainerBuilder {
  const value = new ContainerBuilder().setAccentColor(color(settings.accentColor));
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  if (description) value.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
  return value;
}

function message(value: ContainerBuilder): V2Message {
  return { components: [value], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function panelStatus(panel: Panel, categoryCount: number): string {
  const mode = panel.ticketMode === 'private-threads' ? 'threads privadas' : 'canais';
  const style = panel.style === 'select' ? 'menu' : 'botões';
  return `${panel.enabled ? '🟢' : '⚪'} **${panel.title}**\n\`${panel.key}\` · <#${panel.channelId}> · ${style} · ${mode} · ${categoryCount} categoria(s) · ${panel.messageId ? 'publicado' : 'rascunho'}`;
}

export function buildAdminLauncher(settings: GuildSettings): V2Message {
  const value = container(settings, 'Central administrativa', 'Abra a console privada para configurar tickets, painéis, categorias e canais.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Apenas administradores autorizados podem abrir a central.'));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin-console:launch').setLabel('Abrir central').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
  ));
  return message(value);
}

export function buildAdminHome(session: AdminConsoleSession, settings: GuildSettings, panels: Panel[]): V2Message {
  const published = panels.filter((panel) => panel.messageId).length;
  const value = container(settings, 'Central de tickets', 'Tudo o que está configurado fica visível antes de qualquer alteração.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### Servidor\n${settings.logChannelId ? '✅' : '⚠️'} Logs: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'não definido'}\n${settings.transcriptChannelId ? '✅' : '⚠️'} Transcrições: ${settings.transcriptChannelId ? `<#${settings.transcriptChannelId}>` : 'não definido'}\n👥 Administradores adicionais: ${settings.adminRoleIds.length}\n🎨 Cor padrão: \`${settings.accentColor}\`\n\n### Painéis\n${panels.length} configurado(s) · ${published} publicado(s) · ${panels.length - published} rascunho(s)`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'go:panels', 'Painéis', ButtonStyle.Primary, '🎫'),
    button(session, 'go:settings', 'Servidor', ButtonStyle.Secondary, '⚙️'),
    button(session, 'go:diagnostics', 'Diagnóstico', ButtonStyle.Secondary, '🔎'),
    button(session, 'refresh', 'Atualizar', ButtonStyle.Secondary, '🔄'),
  ));
  return message(value);
}

export function buildAdminPanels(session: AdminConsoleSession, settings: GuildSettings, panels: Panel[], counts: Map<string, number>): V2Message {
  const pageCount = Math.max(1, Math.ceil(panels.length / PAGE_SIZE));
  const page = Math.min(Math.max(session.page, 0), pageCount - 1);
  const visible = panels.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const value = container(settings, 'Painéis de tickets', panels.length ? `Selecione um painel para abrir o editor. Página ${page + 1} de ${pageCount}.` : 'Crie o primeiro painel para começar.');
  if (visible.length) {
    value.addSeparatorComponents(separator());
    value.addTextDisplayComponents(...visible.map((panel) => new TextDisplayBuilder().setContent(panelStatus(panel, counts.get(panel.key) ?? 0))));
    value.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid(session, 'select:panel')).setPlaceholder('Selecione um painel…').addOptions(
        visible.map((panel) => new StringSelectMenuOptionBuilder()
          .setLabel(panel.title.slice(0, 100))
          .setDescription(`${panel.key} · ${panel.messageId ? 'Publicado' : 'Rascunho'}`.slice(0, 100))
          .setValue(panel.key)),
      ),
    ));
  }
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'panel:create', 'Criar painel', ButtonStyle.Primary, '➕'),
    button(session, 'page:previous', 'Anterior', ButtonStyle.Secondary, '⬅️').setDisabled(page === 0),
    button(session, 'page:next', 'Próximo', ButtonStyle.Secondary, '➡️').setDisabled(page >= pageCount - 1),
    button(session, 'go:home', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildPanelCreateChannelPicker(session: AdminConsoleSession, settings: GuildSettings): V2Message {
  const value = container(settings, 'Criar painel', 'Primeiro escolha o canal onde o painel será publicado. Depois você define nome e conteúdo.');
  value.addActionRowComponents(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(cid(session, 'select:create-channel')).setPlaceholder('Escolha um canal de texto…').setChannelTypes(ChannelType.GuildText),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(session, 'go:panels', 'Cancelar', ButtonStyle.Secondary, '🔙')));
  return message(value);
}

export function buildAdminPanel(session: AdminConsoleSession, settings: GuildSettings, panel: Panel, categories: TicketCategory[]): V2Message {
  const mode = panel.ticketMode === 'private-threads' ? 'Threads privadas' : 'Canais em categoria';
  const value = container(settings, panel.title, `\`${panel.key}\` · ${panel.messageId ? '🟢 Publicado' : '🟡 Rascunho'} · ${panel.enabled ? 'Ativo' : 'Desativado'}`);
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### Estado atual\n📍 Publicação: <#${panel.channelId}>\n🗂️ Atendimento: ${mode}\n🧩 Componente: ${panel.style === 'select' ? 'Menu de seleção' : 'Botões'}\n🗃️ Categorias: ${categories.length} (${categories.filter((category) => category.enabled).length} ativas)\n🎨 Cor: \`${panel.color}\`\n🖼️ Banner: ${panel.bannerUrl ? 'definido' : 'não definido'}\n\n-# Salve as alterações e use Publicar para atualizar a mensagem visível aos membros.`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'go:appearance', 'Aparência', ButtonStyle.Secondary, '🖼️'),
    button(session, 'go:route', 'Rota', ButtonStyle.Secondary, '📍'),
    button(session, 'go:categories', 'Categorias', ButtonStyle.Secondary, '🗂️'),
    button(session, 'panel:publish', 'Publicar', ButtonStyle.Success, '🚀'),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'panel:duplicate', 'Duplicar', ButtonStyle.Secondary, '📋'),
    button(session, 'panel:toggle', panel.enabled ? 'Desativar' : 'Ativar', ButtonStyle.Secondary),
    button(session, 'panel:delete:confirm', 'Excluir', ButtonStyle.Danger, '🗑️'),
    button(session, 'go:panels', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminAppearance(session: AdminConsoleSession, settings: GuildSettings, panel: Panel): V2Message {
  const value = container(settings, `Aparência — ${panel.title}`, 'Edite somente o grupo visual que precisa mudar.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Título:** ${panel.title}\n**Cor:** \`${panel.color}\`\n**Banner:** ${panel.bannerUrl ?? 'não definido'}\n**Miniatura:** ${panel.thumbnailUrl ?? 'não definida'}\n**Rodapé:** ${panel.footer ?? 'não definido'}`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'modal:panel-text', 'Texto e rodapé', ButtonStyle.Primary, '✏️'),
    button(session, 'modal:panel-media', 'Cor e imagens', ButtonStyle.Secondary, '🖼️'),
    button(session, 'go:panel', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminRoute(session: AdminConsoleSession, settings: GuildSettings, panel: Panel): V2Message {
  const routeReady = panel.ticketMode === 'private-threads' || panel.parentCategoryId !== panel.channelId;
  const value = container(settings, `Rota — ${panel.title}`, 'Defina onde o painel é publicado e onde os tickets são criados.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Canal do painel:** <#${panel.channelId}>\n**Modo:** ${panel.ticketMode === 'private-threads' ? 'Threads privadas' : 'Canais em categoria'}\n**Categoria de tickets:** ${panel.ticketMode === 'private-threads' ? 'não se aplica' : routeReady ? `<#${panel.parentCategoryId}>` : '⚠️ selecione uma categoria'}\n**Escolha:** ${panel.style === 'select' ? 'Menu de seleção' : 'Botões'}`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'go:route-channel', 'Canal', ButtonStyle.Secondary, '💬'),
    button(session, 'go:route-category', 'Categoria', ButtonStyle.Secondary, '🗂️').setDisabled(panel.ticketMode === 'private-threads'),
    button(session, 'go:route-mode', 'Modo', ButtonStyle.Secondary, '🔁'),
    button(session, 'route:style', panel.style === 'select' ? 'Usar botões' : 'Usar menu', ButtonStyle.Secondary),
    button(session, 'go:panel', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildChannelPicker(session: AdminConsoleSession, settings: GuildSettings, panel: Panel, type: 'panel' | 'category'): V2Message {
  const wantsPanel = type === 'panel';
  const value = container(settings, wantsPanel ? 'Selecionar canal do painel' : 'Selecionar categoria de tickets', wantsPanel ? `Atual: <#${panel.channelId}>` : `Atual: <#${panel.parentCategoryId}>`);
  value.addActionRowComponents(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(cid(session, wantsPanel ? 'select:route-channel' : 'select:route-category'))
      .setPlaceholder(wantsPanel ? 'Escolha um canal de texto…' : 'Escolha uma categoria…')
      .setChannelTypes(wantsPanel ? ChannelType.GuildText : ChannelType.GuildCategory),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(session, 'go:route', 'Voltar', ButtonStyle.Secondary, '🔙')));
  return message(value);
}

export function buildModePicker(session: AdminConsoleSession, settings: GuildSettings, panel: Panel): V2Message {
  const value = container(settings, 'Formato de atendimento', 'Threads ficam dentro do canal do painel; canais usam uma categoria do servidor.');
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'route:mode:threads', 'Threads privadas', panel.ticketMode === 'private-threads' ? ButtonStyle.Primary : ButtonStyle.Secondary, '🧵'),
    button(session, 'route:mode:channels', 'Canais em categoria', panel.ticketMode === 'channels' ? ButtonStyle.Primary : ButtonStyle.Secondary, '💬'),
    button(session, 'go:route', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminCategories(session: AdminConsoleSession, settings: GuildSettings, panel: Panel, categories: TicketCategory[]): V2Message {
  const value = container(settings, `Categorias — ${panel.title}`, categories.length ? 'Selecione uma categoria para editar seu atendimento.' : 'Crie a primeira opção de atendimento deste painel.');
  if (categories.length) {
    value.addSeparatorComponents(separator());
    value.addTextDisplayComponents(...categories.slice(0, 25).map((category) => new TextDisplayBuilder().setContent(
      `${category.enabled ? '🟢' : '⚪'} **${category.name}** · \`${category.key}\`\n${category.description || 'Sem descrição'} · ${category.questions.length} pergunta(s) · ${category.allowedRoleIds.length ? 'restrita' : 'pública'}`,
    )));
    value.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid(session, 'select:category')).setPlaceholder('Selecione uma categoria…').addOptions(
        categories.slice(0, 25).map((category) => new StringSelectMenuOptionBuilder().setLabel(category.name.slice(0, 100)).setDescription(`${category.key} · ${category.enabled ? 'Ativa' : 'Inativa'}`.slice(0, 100)).setValue(category.key)),
      ),
    ));
  }
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'modal:category-create', 'Criar categoria', ButtonStyle.Primary, '➕'),
    button(session, 'go:panel', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminCategory(session: AdminConsoleSession, settings: GuildSettings, panel: Panel, category: TicketCategory): V2Message {
  const value = container(settings, `Categoria — ${category.name}`, `Painel: **${panel.title}** · \`${category.key}\``);
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Descrição:** ${category.description || 'não definida'}\n**Acesso:** ${category.allowedRoleIds.length ? `${category.allowedRoleIds.length} cargo(s)` : 'público'}\n**Equipe:** ${category.staffRoleIds.length ? `${category.staffRoleIds.length} cargo(s)` : 'todos os administradores'}\n**Perguntas:** ${category.questions.length}/5\n**Limite por usuário:** ${category.maxOpenPerUser}\n**Status:** ${category.enabled ? 'ativa' : 'inativa'}`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'modal:category-edit', 'Detalhes', ButtonStyle.Primary, '✏️'),
    button(session, 'go:category-access', 'Acesso', ButtonStyle.Secondary, '🔐'),
    button(session, 'go:category-team', 'Equipe', ButtonStyle.Secondary, '👥'),
    button(session, 'go:forms', 'Formulário', ButtonStyle.Secondary, '📋'),
    button(session, 'go:category-behaviour', 'Regras', ButtonStyle.Secondary, '⚙️'),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'category:toggle', category.enabled ? 'Desativar' : 'Ativar', ButtonStyle.Secondary),
    button(session, 'category:delete:confirm', 'Excluir', ButtonStyle.Danger, '🗑️'),
    button(session, 'go:categories', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildRolePicker(session: AdminConsoleSession, settings: GuildSettings, title: string, current: string[], action: string, description: string): V2Message {
  const value = container(settings, title, description);
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(current.length ? `Atual: ${current.map((id) => `<@&${id}>`).join(', ')}` : 'Atual: nenhum cargo selecionado.'));
  value.addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId(cid(session, action)).setPlaceholder('Selecione cargos…').setMinValues(0).setMaxValues(25),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(session, 'back:category', 'Voltar', ButtonStyle.Secondary, '🔙')));
  return message(value);
}

export function buildCategoryBehaviour(session: AdminConsoleSession, settings: GuildSettings, category: TicketCategory): V2Message {
  const value = container(settings, `Regras — ${category.name}`, 'Ajuste comportamento, botão e limite sem alterar a aparência do painel.');
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Botão:** ${category.buttonStyle}\n**Usuário pode fechar:** ${category.allowUserClose ? 'sim' : 'não'}\n**Permite reivindicar:** ${category.allowClaim ? 'sim' : 'não'}\n**Limite aberto por usuário:** ${category.maxOpenPerUser}`,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'category:style', 'Estilo do botão', ButtonStyle.Secondary),
    button(session, 'category:close', category.allowUserClose ? 'Bloquear fechamento' : 'Permitir fechamento', ButtonStyle.Secondary),
    button(session, 'category:claim', category.allowClaim ? 'Ocultar claim' : 'Permitir claim', ButtonStyle.Secondary),
    button(session, 'modal:category-limit', 'Limite', ButtonStyle.Secondary),
    button(session, 'back:category', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminForms(session: AdminConsoleSession, settings: GuildSettings, category: TicketCategory): V2Message {
  const value = container(settings, `Formulário — ${category.name}`, category.questions.length ? 'Selecione uma pergunta para ajustar detalhes.' : 'Sem perguntas: o ticket abre diretamente.');
  if (category.questions.length) {
    value.addSeparatorComponents(separator());
    value.addTextDisplayComponents(...category.questions.map((question, index) => new TextDisplayBuilder().setContent(
      `${index + 1}. **${question.label}** · \`${question.id}\` · ${question.style === 'paragraph' ? 'parágrafo' : 'curta'} · ${question.required ? 'obrigatória' : 'opcional'}`,
    )));
    value.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid(session, 'select:question')).setPlaceholder('Selecione uma pergunta…').addOptions(
        category.questions.map((question) => new StringSelectMenuOptionBuilder().setLabel(question.label.slice(0, 100)).setDescription(question.id.slice(0, 100)).setValue(question.id)),
      ),
    ));
  }
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'modal:question-create', 'Adicionar pergunta', ButtonStyle.Primary, '➕').setDisabled(category.questions.length >= 5),
    button(session, 'back:category', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildAdminQuestion(session: AdminConsoleSession, settings: GuildSettings, question: TicketQuestion): V2Message {
  const value = container(settings, `Pergunta — ${question.label}`, `\`${question.id}\` · ${question.style === 'paragraph' ? 'Parágrafo' : 'Texto curto'} · ${question.required ? 'Obrigatória' : 'Opcional'}`);
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Placeholder:** ${question.placeholder ?? 'não definido'}\n**Mínimo:** ${question.minLength ?? 'não definido'} · **Máximo:** ${question.maxLength ?? 'não definido'}`));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'modal:question-edit', 'Texto', ButtonStyle.Primary, '✏️'),
    button(session, 'question:style', question.style === 'paragraph' ? 'Usar texto curto' : 'Usar parágrafo', ButtonStyle.Secondary),
    button(session, 'question:required', question.required ? 'Tornar opcional' : 'Tornar obrigatória', ButtonStyle.Secondary),
    button(session, 'modal:question-limits', 'Limites', ButtonStyle.Secondary),
    button(session, 'question:delete', 'Remover', ButtonStyle.Danger, '🗑️'),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(session, 'go:forms', 'Voltar', ButtonStyle.Secondary, '🔙')));
  return message(value);
}

export function buildAdminSettings(session: AdminConsoleSession, settings: GuildSettings): V2Message {
  const value = container(settings, 'Configurações do servidor', 'Estas opções valem para todos os painéis deste servidor.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Logs:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'não definido'}\n**Transcrições:** ${settings.transcriptChannelId ? `<#${settings.transcriptChannelId}>` : 'não definido'}\n**Administradores adicionais:** ${settings.adminRoleIds.length ? settings.adminRoleIds.map((id) => `<@&${id}>`).join(', ') : 'nenhum'}\n**Cor padrão:** \`${settings.accentColor}\``,
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'go:settings-logs', 'Logs', ButtonStyle.Secondary, '📜'),
    button(session, 'go:settings-transcripts', 'Transcrições', ButtonStyle.Secondary, '📄'),
    button(session, 'go:settings-admins', 'Administradores', ButtonStyle.Secondary, '👥'),
    button(session, 'modal:settings-color', 'Cor', ButtonStyle.Secondary, '🎨'),
    button(session, 'go:home', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildSettingsChannelPicker(session: AdminConsoleSession, settings: GuildSettings, kind: 'logs' | 'transcripts'): V2Message {
  const title = kind === 'logs' ? 'Canal de logs' : 'Canal de transcrições';
  const current = kind === 'logs' ? settings.logChannelId : settings.transcriptChannelId;
  const value = container(settings, title, current ? `Atual: <#${current}>` : 'Nenhum canal definido.');
  value.addActionRowComponents(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(cid(session, `select:settings-${kind}`)).setPlaceholder('Selecione um canal de texto…').setChannelTypes(ChannelType.GuildText),
  ));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, `settings:${kind}:clear`, 'Remover configuração', ButtonStyle.Danger, '🗑️'),
    button(session, 'go:settings', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildDiagnostics(session: AdminConsoleSession, settings: GuildSettings, panels: Panel[], checks: Array<[string, boolean]>): V2Message {
  const value = container(settings, 'Diagnóstico', 'Leitura segura da configuração e das permissões essenciais do bot.');
  value.addSeparatorComponents(separator());
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(checks.map(([label, ok]) => `${ok ? '✅' : '❌'} ${label}`).join('\n')));
  value.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\nPainéis: ${panels.length} · Logs: ${settings.logChannelId ? 'definido' : 'pendente'} · Transcrições: ${settings.transcriptChannelId ? 'definido' : 'pendente'}`));
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, 'refresh', 'Atualizar', ButtonStyle.Secondary, '🔄'),
    button(session, 'go:home', 'Voltar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}

export function buildDeleteConfirmation(session: AdminConsoleSession, settings: GuildSettings, kind: 'panel' | 'category' | 'question', name: string): V2Message {
  const label = kind === 'panel' ? 'painel' : kind === 'category' ? 'categoria' : 'pergunta';
  const value = container(settings, `Excluir ${label}?`, `Você está prestes a excluir **${name}**. Esta ação remove a configuração; mensagens publicadas não são apagadas automaticamente.`);
  value.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, `delete:${kind}`, 'Confirmar exclusão', ButtonStyle.Danger, '🗑️'),
    button(session, kind === 'panel' ? 'go:panel' : kind === 'category' ? 'back:category' : 'go:question', 'Cancelar', ButtonStyle.Secondary, '🔙'),
  ));
  return message(value);
}
