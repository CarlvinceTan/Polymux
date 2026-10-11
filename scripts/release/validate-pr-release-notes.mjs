const RELEASE_NOTES_HEADING = 'Release Notes:';
const USER_FACING_NOTE = /^- ([A-Z][A-Za-z0-9 &/-]*): (Added|Fixed|Improved) (\S(?:.*\S)?\.)$/;

export function validatePullRequestBody(body) {
  const normalized = String(body ?? '').replaceAll('\r\n', '\n').trimEnd();
  const match = normalized.match(new RegExp(`(?:^|\\n)${RELEASE_NOTES_HEADING}\\n\\n([\\s\\S]*)$`));

  if (!match) {
    throw new Error('The pull request body must end with a "Release Notes:" section followed by one bullet.');
  }

  const note = match[1];
  if (note.includes('\n') || !note.startsWith('- ')) {
    throw new Error('The "Release Notes:" section must contain exactly one bullet and be the final section.');
  }

  if (note !== '- N/A' && !USER_FACING_NOTE.test(note)) {
    throw new Error(
      'Use "- <Area>: <Added|Fixed|Improved> <user-facing outcome>." or "- N/A" for release notes.',
    );
  }

  return note;
}

if (process.argv[1] === import.meta.filename) {
  try {
    validatePullRequestBody(process.env.PR_BODY);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
