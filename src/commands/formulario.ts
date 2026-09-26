import { ActionRowBuilder, ChatInputCommandInteraction, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { TicketBotClient } from '../bot/TicketBotClient';
import { normalizeKey } from '../domain/models';
import { adminSessions } from '../services/AdminSessionStore';
import { completePanelOrCategory, ephemeral, requireAdministrator, requireGuild } from './helpers';

export interface QuestionModalSession {
  kind: 'question-add';
  guildId: string;
  panelKey: string;
  categoryKey: string;
  id: string;
  style: 'short' | 'paragraph';
  required: boolean;
}

const panelOption = (option: any) => option.setName('painel').setDescription('Painel').setRequired(true).setAutocomplete(true);
const categoryOption = (option: any) => option.setName('categoria').setDescription('Categoria').setRequired(true).setAutocomplete(true);

export const data = new SlashCommandBuilder().setName('formulario').setDescription('Configura perguntas antes da abertura')
  .addSubcommand((sub) => sub.setName('adicionar').setDescription('Adiciona uma pergunta (máximo 5)')
    .addStringOption(panelOption).addStringOption(categoryOption)
    .addStringOption((option) => option.setName('id').setDescription('Identificador do campo').setRequired(true).setMaxLength(31))
    .addStringOption((option) => option.setName('tipo').setDescription('Tipo de resposta').setRequired(true).addChoices({ name: 'Curta', value: 'short' }, { name: 'Parágrafo', value: 'paragraph' }))
    .addBooleanOption((option) => option.setName('obrigatoria').setDescription('Resposta obrigatória?').setRequired(true)))
  .addSubcommand((sub) => sub.setName('remover').setDescription('Remove uma pergunta')
    .addStringOption(panelOption).addStringOption(categoryOption)
    .addStringOption((option) => option.setName('campo').setDescription('ID do campo').setRequired(true)))
  .addSubcommand((sub) => sub.setName('lista').setDescription('Lista as perguntas').addStringOption(panelOption).addStringOption(categoryOption));

export async function execute(interaction: ChatInputCommandInteraction, client: TicketBotClient): Promise<void> {
  requireGuild(interaction);
  requireAdministrator(interaction, client);
  const sub = interaction.options.getSubcommand();
  const panelKey = interaction.options.getString('painel', true);
  const categoryKey = interaction.options.getString('categoria', true);
  const category = client.repository.getCategory(interaction.guildId, panelKey, categoryKey);

  if (sub === 'adicionar') {
    if (category.questions.length >= 5) throw new Error('O Discord permite no máximo 5 perguntas por modal.');
    const id = normalizeKey(interaction.options.getString('id', true));
    if (category.questions.some((question) => question.id === id)) throw new Error(`O campo \`${id}\` já existe.`);
    const session: QuestionModalSession = {
      kind: 'question-add', guildId: interaction.guildId, panelKey, categoryKey, id,
      style: interaction.options.getString('tipo', true) as 'short' | 'paragraph',
      required: interaction.options.getBoolean('obrigatoria', true),
    };
    const modal = new ModalBuilder().setCustomId(`admin:question:${adminSessions.create(session)}`).setTitle('Adicionar pergunta').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Pergunta').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('Texto de exemplo (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Mínimo de caracteres (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Máximo de caracteres (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4)),
    );
    await interaction.showModal(modal);
    return;
  }

  if (sub === 'remover') {
    const id = interaction.options.getString('campo', true);
    const questions = category.questions.filter((question) => question.id !== id);
    client.repository.setQuestions(interaction.guildId, panelKey, categoryKey, questions);
    await interaction.reply({ content: `✅ Campo \`${id}\` removido.`, flags: ephemeral });
    return;
  }

  const lines = category.questions.map((question, index) => `${index + 1}. **${question.label}** — \`${question.id}\` • ${question.style} • ${question.required ? 'obrigatória' : 'opcional'}`);
  await interaction.reply({ content: `**Formulário de ${category.name}:**\n\n${lines.join('\n') || 'Sem perguntas; o ticket abre diretamente.'}`, flags: ephemeral });
}

export const autocomplete = completePanelOrCategory;
