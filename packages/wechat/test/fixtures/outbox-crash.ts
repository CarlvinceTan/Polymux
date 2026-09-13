import {WeChatOutbox} from "../../src/wechat-outbox.js";

const outbox = new WeChatOutbox(process.argv[2]);
outbox.claim("$interrupted", "@fixture:local", "filehelper");
outbox.textCandidate("$interrupted", "crash fixture", 123_000, ["old-id"]);
process.send?.("committed");
setInterval(() => {}, 1_000);
