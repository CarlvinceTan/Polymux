#!/bin/bash
# --scan <worktree> [folders...]: read-only acceptance scan; never changes briefs.
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$SRC" "$@" <<'PY'
import os, pathlib, subprocess, sys, tempfile
src = pathlib.Path(sys.argv[1])
guard = src / 'scripts/dispatch-guard.sh'
def check(brief, root, script=guard, env=None):
    return subprocess.run(['bash', str(script), '--brief', str(brief), str(root)],
                          capture_output=True, text=True, env=env)
if len(sys.argv) > 2 and sys.argv[2] == '--scan':
    root = pathlib.Path(sys.argv[3]).resolve()
    folders = [pathlib.Path(p).expanduser() for p in sys.argv[4:]] or [
        pathlib.Path.home() / 'ops/lanes' / p for p in ('queue', 'queue-hold', 'queue/started')]
    if any(not p.is_dir() for p in folders):
        sys.exit('scan incomplete: every queue folder must exist')
    briefs = sorted({p for d in folders for p in d.glob('*.task')})
    if not briefs: sys.exit('scan incomplete: no briefs found')
    holds = 0
    for brief in briefs:
        result = check(brief, root)
        if result.stderr: print(result.stderr, end='')
        if result.returncode:
            holds += 1
            print(f'HOLD {brief}: {result.stdout.strip()} {result.stderr.strip()}')
    print(f'dispatch scan: {len(briefs)} briefs, {holds} holds')
    if holds: sys.exit('STOP: review listed briefs; do not enable live checks')
    print('Zero false holds; scan was read-only')
    sys.exit(0)
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    binpath = root / 'bin'
    binpath.mkdir()
    gh = binpath / 'gh'
    gh.write_text('#!/bin/bash\ncase "$*" in\n*"view 7 "*) echo MERGED;;\n*"view "*) echo OPEN;;\n*"--head merged-topic "*) echo 7;;\n*"--json title"*) echo \'[{"title":"polymux/NC: Done"}]\';;\n*) echo none;;\nesac\n')
    gh.chmod(0o755)
    env = dict(os.environ, PATH=str(binpath) + ':' + os.environ['PATH'])
    baseline = root / 'baseline.sh'
    baseline.write_text(subprocess.check_output(
        ['git', '-C', str(src), 'show', '497a651:scripts/dispatch-guard.sh'], text=True))
    cases = [
        ('absolute', 'Spec: /workspace/polymux-merge/X.md#missing', 0),
        ('output', 'Create capture-notes.md and .proof/unit/pr-body.md', 0),
        ('queue note', 'queue-note: see queue/other.task and queue-hold/other.task', 0),
        ('none', 'Deps: None.', 0),
        ('decimal', 'Deps: 1.2', 0),
        ('bare unit', 'Deps: SB1.', 0),
        ('other prose', 'Deps: (cloud RT1.', 0),
        ('tilde', 'Spec: ~/specs/X.md#missing', 0),
        ('absolute dotted', 'Spec: /workspace/polymux.merge/X.md#missing', 0),
        ('output with input', 'Create result.md using missing.md#section', 4),
        ('queue index', 'Spec: QUEUE.md', 0),
        ('output anchor', 'Create capture-notes.md#result', 0),
        ('proof anchor', 'Spec: .proof/unit/pr-body.md#result', 0),
        ('queue anchor', 'Spec: queue/other.task#result', 0),
        ('missing spec', 'Spec: missing.md', 4),
        ('missing anchor', 'spec: SPEC.md#missing', 4),
        ('anchor input', 'Read missing.md#section', 4),
        ('section input', 'Read missing.md §2', 4),
        ('existing spec', 'Spec: SPEC.md#overview', 0),
        ('existing section', 'Read SPEC.md §2', 0),
        ('unmerged dep', 'Deps: pr:8.', 4),
        ('merged dep', 'Deps: pr:7;', 0),
        ('unit dep', 'Deps: polymux/WS1', 4),
        ('merged unit', 'Deps: polymux/NC', 0),
        ('after dep', 'after: pr:8', 4),
        ('merged after', 'after: pr:7', 0),
        ('after wins', 'after: pr:7\nDeps: pr:8', 0),
        ('merged branch', 'after: branch-on-main:merged-topic', 0),
    ]
    (root / 'SPEC.md').write_text('# Overview\n## 2. Details\n')
    failures = []
    for index, (name, body, expected) in enumerate(cases):
        brief = root / 'brief.task'
        brief.write_text('# Test\n' + body + '\n')
        result = check(brief, root, env=env)
        if result.returncode != expected:
            failures.append(name)
            print(f'FAIL {name}: {result.returncode}, {result.stdout} {result.stderr}')
        else: print(f'ok   {name}')
        if index < 6:
            assert check(brief, root, baseline, env).returncode == 4, name + ': baseline must hold'
        if name in ('decimal', 'bare unit', 'other prose'):
            assert 'warning:' in result.stderr, name + ': prose must warn'
    # Resolve an input from the brief branch without changing its checkout.
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Dispatch Test')
    git('config', 'user.email', 'dispatch@test.invalid')
    git('add', 'SPEC.md')
    git('commit', '-qm', 'Spec')
    (root / 'SPEC.md').unlink()
    brief.write_text('branch: main\nSpec: SPEC.md#overview\n')
    assert check(brief, root, env=env).returncode == 0, 'branch spec'
    brief.write_text('after: pr:8\n')
    assert check(brief, root, baseline, env).returncode == 4, 'baseline real dep'
    brief.write_text('Spec: missing.md\n')
    assert check(brief, root, baseline, env).returncode == 4, 'baseline real spec'
    # Exercise the same read-only scan with all three folder shapes.
    folders = [root / p for p in ('queue', 'queue-hold', 'queue/started')]
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'brief.task').write_text('Deps: None.\nCreate capture-notes.md\n')
    before = {p: p.read_bytes() for d in folders for p in d.glob('*.task')}
    result = subprocess.run(['bash', str(src / 'scripts/test-dispatch-guard.sh'),
                             '--scan', str(root), *map(str, folders)], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert before == {p: p.read_bytes() for d in folders for p in d.glob('*.task')}
    print(result.stdout, end='')
    print('497a651: six false-hold regressions reproduced; real spec/dep holds preserved')
    if failures: sys.exit(f'{len(failures)} dispatch tests failed')
    print(f'test-dispatch-guard: {len(cases)} cases plus branch and read-only scan passed')
PY
