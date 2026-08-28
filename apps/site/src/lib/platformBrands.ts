import bluesky from '../../../desktop/src/renderer/assets/platforms/bluesky.svg?url';
import discord from '../../../desktop/src/renderer/assets/platforms/discord.svg?url';
import fastmail from '../../../desktop/src/renderer/assets/platforms/fastmail.svg?url';
import gmail from '../../../desktop/src/renderer/assets/platforms/gmail.svg?url';
import gmessages from '../../../desktop/src/renderer/assets/platforms/gmessages.svg?url';
import googlechat from '../../../desktop/src/renderer/assets/platforms/googlechat.svg?url';
import gvoice from '../../../desktop/src/renderer/assets/platforms/gvoice.svg?url';
import icloud from '../../../desktop/src/renderer/assets/platforms/icloud.svg?url';
import imessage from '../../../desktop/src/renderer/assets/platforms/imessage.svg?url';
import instagram from '../../../desktop/src/renderer/assets/platforms/instagram.svg?url';
import lark from '../../../desktop/src/renderer/assets/platforms/lark.png';
import linkedin from '../../../desktop/src/renderer/assets/platforms/linkedin.svg?url';
import mail from '../../../desktop/src/renderer/assets/platforms/mail.png';
import matrix from '../../../desktop/src/renderer/assets/platforms/matrix.svg?url';
import messenger from '../../../desktop/src/renderer/assets/platforms/messenger.svg?url';
import outlook from '../../../desktop/src/renderer/assets/platforms/outlook.svg?url';
import signal from '../../../desktop/src/renderer/assets/platforms/signal.svg?url';
import slack from '../../../desktop/src/renderer/assets/platforms/slack.svg?url';
import telegram from '../../../desktop/src/renderer/assets/platforms/telegram.svg?url';
import twitter from '../../../desktop/src/renderer/assets/platforms/twitter.svg?url';
import wechat from '../../../desktop/src/renderer/assets/platforms/wechat.svg?url';
import whatsapp from '../../../desktop/src/renderer/assets/platforms/whatsapp.svg?url';
import zulip from '../../../desktop/src/renderer/assets/platforms/zulip.svg?url';

// Keep this mapping site-local so a standalone site build does not load the
// desktop renderer's TypeScript project configuration.
const bridgeLogos: Record<string, string> = {
  whatsapp,
  telegram,
  signal,
  discord,
  slack,
  messenger,
  instagram,
  linkedin,
  googlechat,
  gmessages,
  twitter,
  bluesky,
  gvoice,
  zulip,
  imessage,
  wechat,
  matrix,
};

const mailLogos: Record<string, string> = {
  gmail,
  outlook,
  icloud,
  lark,
  fastmail,
  custom: mail,
};

export function bridgeLogo(platform: string): string | null {
  return bridgeLogos[platform] ?? null;
}

export function mailLogo(preset: string): string | null {
  return mailLogos[preset] ?? null;
}
