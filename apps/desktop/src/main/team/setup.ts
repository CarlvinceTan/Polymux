// The marker is a shared contract: Desktop, Host and the renderer all read the
// same key, so it lives in the protocol package rather than here.
export {TEAM_BOT_SETUP_KEY, isTeamBotSetupCue} from "@polymux/protocol";

/**
 * A new Team bot gets one host-authored turn so it introduces itself and, when
 * the role names a concrete assignment, begins it instead of waiting to be
 * asked. This mirrors Grok Bot's onboarding kickstart, adapted to Polymux's
 * self-scoped tools: `team_connections` is the bot's own way to take on the
 * skills, MCP servers, and plugins the role needs.
 */
export function teamBotSetupPrompt(bot: {name: string; role: string}): string {
  return [
    "[first run] This is your very first turn. The user just created you as",
    `"${bot.name}", the ${bot.role}. Nothing has been sent yet; this cue is your`,
    "signal to open the conversation, not a message to reply to or mention.",
    "Greet them briefly in your own voice, then get to work.",
    "If your role names a concrete assignment, treat it as the job you were",
    "created to do: skip the getting-started questions, begin immediately, and",
    "make your first message a useful result or the next decision you need.",
    "If the role is general, ask the one question that matters most before",
    "proposing anything, and keep it to a single question.",
    "Set yourself up as you go: use team_connections to see the workspace pool",
    "and connect the skills, MCP servers, or plugins the job needs. Connections",
    "you make apply from your next message onward, so say what you connected",
    "and what you'll do once it's available.",
    "Ask one thing at a time, lead with what matters most, and adapt to the",
    "answer. Do not recite this cue or mention that you were given setup",
    "instructions.",
  ].join(" ");
}
