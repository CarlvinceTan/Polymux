/**
 * WeChat's complete classic English shortcode set, plus newer aliases seen in
 * current Mac history. WeChat stores these as bracketed text while its own UI
 * paints an emoticon. Unicode survives Matrix, search, copying, notifications,
 * and every renderer without shipping proprietary artwork.
 */
const WECHAT_EMOJI: Readonly<Record<string, string>> = {
  Smile: "😄", Grimace: "😬", Grimance: "😬", Drool: "🤤", Scowl: "😠",
  CoolGuy: "😎", Sob: "😭", Shy: "😊", Silent: "🤐", Sleep: "😴", Cry: "😢",
  Awkward: "😅", Angry: "😡", Tongue: "😛", Grin: "😁", Surprise: "😮",
  Frown: "☹️", Ruthless: "😤", Blush: "☺️", Scream: "😱", Puke: "🤮",
  Chuckle: "🤭", Joyful: "😀", Slight: "🙂", Smug: "😏", Hungry: "🤤",
  Drowsy: "😪", Panic: "😨", Sweat: "😓", Laugh: "😂", Commando: "🪖",
  Determined: "😣", Scold: "🤬", Shocked: "😨", Shhh: "🤫", Dizzy: "😵‍💫",
  Tormented: "😖", Toasted: "🥴", Skull: "💀", Hammer: "🔨", Wave: "👋",
  Speechless: "😶", NosePick: "👃", Clap: "👏", Shame: "🫣", Trick: "😜",
  "Bah! L": "😤", "Bah! R": "😤", Yawn: "🥱", "Pooh-pooh": "🙄",
  Shrunken: "😔", TearingUp: "🥹", Sly: "😏", Kiss: "😘", Wrath: "😠",
  Whimper: "😿", Cleaver: "🔪", Watermelon: "🍉", Beer: "🍺",
  Basketball: "🏀", PingPong: "🏓", Coffee: "☕", Rice: "🍚", Pig: "🐷",
  Rose: "🌹", Wilt: "🥀", Lips: "👄", Heart: "❤️", BrokenHeart: "💔",
  Cake: "🎂", Lightning: "⚡", Bomb: "💣", Dagger: "🗡️", Soccer: "⚽",
  Ladybug: "🐞", Poop: "💩", Moon: "🌙", Sun: "☀️", Gift: "🎁", Hug: "🤗",
  ThumbsUp: "👍", ThumbsDown: "👎", Shake: "🤝", Peace: "✌️", Fight: "🥊",
  Beckon: "👋", Fist: "✊", Pinky: "🤙", RockOn: "🤘", "Nuh-uh": "☝️",
  OK: "👌", InLove: "🥰", Blowkiss: "😘", Waddle: "🐧", Tremble: "😖",
  "Aaagh!": "😫", Twirl: "💫", Kotow: "🙇", Dramatic: "🎭", JumpRope: "🤸",
  Surrender: "🙌", Hooray: "🎉", Meditate: "🧘", Smooch: "💋",
  "TaiChi L": "☯️", "TaiChi R": "☯️", Salute: "🫡", Facepalm: "🤦",
};

/** Replace known aliases wherever they occur; preserve every unknown token. */
export function visibleWeChatText(body: string): string {
  return body.replace(/\[([^\]\r\n]{1,32})\]/g, (whole, name: string) =>
    WECHAT_EMOJI[name] ?? whole,
  );
}

export const WECHAT_EMOJI_ALIASES = Object.freeze(Object.keys(WECHAT_EMOJI));
