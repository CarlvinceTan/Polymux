export function validateGroupRename({chatId, name, expectedName}) {
  if (typeof chatId !== "string" || !/^[1-9]\d{0,30}@chatroom$/.test(chatId))
    throw new Error("Only WeChat groups can be renamed");
  if (typeof name !== "string" || !name.trim() || name !== name.trim() ||
      /[\u0000-\u001f\u007f]/.test(name) || Buffer.byteLength(name) > 1024 ||
      Buffer.from(name).toString() !== name)
    throw new Error("Enter a valid group name");
  if (typeof expectedName !== "string" || Buffer.byteLength(expectedName) > 4096)
    throw new Error("Reload the current WeChat group name before renaming it");
}

/** Read again inside the native writer lease: the user may have left the
 * form open or another queued operation may have renamed this group. */
export async function renameDesktopGroup(request, {
  read, submit, isolate, timeoutMs = 15_000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  validateGroupRename(request);
  await isolate(async () => {
    const current = await read();
    if (current.chatId !== request.chatId || !current.isMember)
      throw new Error("You are no longer a member of this WeChat group");
    if (current.name === request.name) return;
    if (current.name !== request.expectedName)
      throw new Error("The group name changed in WeChat. Reload the current name and try again.");
    await submit(request.chatId, request.name);
  });
  const deadline = now() + timeoutMs;
  let matched = false;
  do {
    const current = await read();
    if (current.chatId !== request.chatId || !current.isMember)
      throw new Error("WeChat could not confirm this group's membership after renaming it");
    if (current.name === request.name) {
      if (matched) return {deliveredVerified: true};
      matched = true;
    } else {
      matched = false;
    }
    await sleep(400);
  } while (now() < deadline);
  return {deliveredVerified: false,
    reason: "WeChat has not confirmed the new group name. Reload its current name before trying again."};
}
