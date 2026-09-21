import type {BotDto, TeamGroupDto} from '@polymux/protocol';

/** The members a group actually holds, in the order it lists them. */
export function teamGroupMembers(group: Pick<TeamGroupDto, 'memberIds'>, bots: BotDto[]): BotDto[] {
  return group.memberIds.flatMap((id) => bots.find((member) => member.id === id) ?? []);
}

/**
 * A group with no name of its own is named for its members, so a chat created
 * from the To: bar reads as the list of who is in it. Renaming replaces that
 * with the chosen name; clearing the name restores the member list.
 */
export function teamGroupName(group: Pick<TeamGroupDto, 'name' | 'memberIds'>, bots: BotDto[]): string {
  const chosen = group.name.trim();
  if (chosen) return chosen;
  return teamGroupMembers(group, bots).map((member) => member.name).join(', ');
}
