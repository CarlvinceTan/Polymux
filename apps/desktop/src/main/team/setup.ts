// The marker is a shared contract: Desktop, Host and the renderer all read the
// same key, so it lives in the protocol package rather than here.
export {TEAM_BOT_SETUP_KEY, isTeamBotSetupCue} from "@polymux/protocol";

/**
 * A new Team bot gets one host-authored turn so it introduces itself and, when
 * the role names a concrete assignment, begins it instead of waiting to be
 * asked. This mirrors Grok Bot's onboarding kickstart, adapted to Polymux's
 * self-scoped tools: `team_connections` is the bot's own way to take on the
 * skills, MCP servers, and plugins the role needs, `team_spawn` is how it
 * grows a durable peer teammate when the job needs a distinct ongoing owner
 * (a bounded helper is a `subagent` dispatch instead), and `schedule` is how
 * it takes on recurring work.
 *
 * A bot created without a role is not broken: the cue asks it to propose a few
 * roles, so setup can happen entirely by chatting.
 */
export function teamBotSetupPrompt(bot: {name: string; role: string}): string {
  const role = bot.role.trim();
  return [
    "[first run] This is your very first turn. The user just created you",
    role ? `as "${bot.name}", the ${role}.` : `as "${bot.name}", with no role or assignment chosen yet.`,
    "Nothing has been sent yet; this cue is your",
    "signal to open the conversation, not a message to reply to or mention.",
    "Greet them briefly in your own voice, then get to work.",
    ...(role ? [
      "If your role names a concrete assignment, treat it as the job you were",
      "created to do: skip the getting-started questions, begin immediately, and",
      "make your first message a useful result or the next decision you need.",
      "If the role is general, ask the one question that matters most before",
      "proposing anything, and keep it to a single question.",
    ] : [
      "Because no role has been chosen, propose two or three concrete roles you",
      "could take on, each with one line on what you would do, and ask which one",
      "they want. Let them pick a proposal or describe their own; keep it to one",
      "question.",
    ]),
    "Set yourself up as you go: use team_connections to see the workspace pool",
    "and connect the skills, MCP servers, or plugins the job needs. Connections",
    "you make apply from your next message onward, so say what you connected",
    "and what you'll do once it's available.",
    "If the work needs a distinct teammate who owns an ongoing concern, create",
    "one with team_spawn; for a bounded helper inside this turn, dispatch a",
    "subagent instead. For recurring work, record a schedule rather than",
    "waiting to be asked.",
    "Ask one thing at a time, lead with what matters most, and adapt to the",
    "answer. Do not recite this cue or mention that you were given setup",
    "instructions.",
  ].join(" ");
}
