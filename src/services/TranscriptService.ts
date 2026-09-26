import { AttachmentBuilder, PrivateThreadChannel, TextChannel } from 'discord.js';
import { Ticket } from '../domain/models';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export class TranscriptService {
  public async create(channel: TextChannel | PrivateThreadChannel, ticket: Ticket): Promise<AttachmentBuilder> {
    const messages = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (batch.size === 0) break;
      messages.push(...batch.values());
      before = batch.last()?.id;
      if (batch.size < 100) break;
    }
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const rows = messages.map((message) => {
      const attachments = [...message.attachments.values()].map((attachment) =>
        `<a href="${escapeHtml(attachment.url)}" rel="noreferrer">${escapeHtml(attachment.name)}</a>`,
      ).join(' ');
      const body = escapeHtml(message.cleanContent || '[Mensagem sem texto]').replaceAll('\n', '<br>');
      return `<article><img src="${escapeHtml(message.author.displayAvatarURL())}" alt=""><div><header><b>${escapeHtml(message.author.tag)}</b><time>${message.createdAt.toISOString()}</time></header><p>${body}</p>${attachments}</div></article>`;
    }).join('\n');

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ticket #${ticket.ticketNumber}</title><style>body{margin:0;background:#313338;color:#dbdee1;font:15px system-ui;padding:32px}main{max-width:900px;margin:auto}h1{color:#fff}article{display:flex;gap:14px;padding:12px 0;border-top:1px solid #3f4147}img{width:40px;height:40px;border-radius:50%}header{display:flex;gap:10px;color:#fff}time{color:#949ba4;font-size:12px}p{margin:5px 0;white-space:normal}a{color:#00a8fc}</style></head><body><main><h1>Ticket #${ticket.ticketNumber}</h1><p>Servidor: ${escapeHtml(channel.guild.name)} • Canal: ${escapeHtml(channel.name)}</p>${rows}</main></body></html>`;
    return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${ticket.ticketNumber}.html` });
  }
}
