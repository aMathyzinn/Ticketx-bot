import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { TicketRepository } from '../database/TicketRepository';
import { AuthorizationService } from '../services/AuthorizationService';
import { TicketService } from '../services/TicketService';
import { TranscriptService } from '../services/TranscriptService';
import { PanelManagementService } from '../services/PanelManagementService';
import { BotCommand } from '../types/command';

export class TicketBotClient extends Client {
  public readonly commands = new Collection<string, BotCommand>();
  public readonly authorization: AuthorizationService;
  public readonly panels: PanelManagementService;
  public readonly tickets: TicketService;

  public constructor(public readonly repository: TicketRepository) {
    super({ intents: [GatewayIntentBits.Guilds] });
    this.authorization = new AuthorizationService(repository);
    this.panels = new PanelManagementService(repository);
    this.tickets = new TicketService(repository, this.authorization, new TranscriptService());
  }
}
