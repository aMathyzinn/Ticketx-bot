import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { TicketRepository } from '../database/TicketRepository';
import { TicketCategory } from '../domain/models';

export class AuthorizationService {
  public constructor(private readonly repository: TicketRepository) {}

  public isAdministrator(member: GuildMember): boolean {
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const settings = this.repository.ensureGuild(member.guild.id);
    return settings.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  public isStaff(member: GuildMember, category: TicketCategory): boolean {
    return this.isAdministrator(member)
      || member.permissions.has(PermissionFlagsBits.ManageChannels)
      || category.staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }
}
