#!/bin/bash
SD=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$SD/../lib/locks.sh"

repo_slug() {
  git -C "${1:-.}" remote get-url origin |
    sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##'
}

verdict_key() {
  if [ -n "${VERDICT_KEY_CMD:-}" ]; then
    bash -c "$VERDICT_KEY_CMD"
  else
    vault get "${VERDICT_KEY_TITLE:-Polymux review verdict HMAC}" 2>/dev/null |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])'
  fi
}

NOTION_PERL='
  my $H = qr/(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{32}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})(?![0-9A-Fa-f])/;
  my $U = qr{(?:https?://)?(?:[\w-]+\.)*(?:notion\.so|notion\.site)(?:/[^\s)\]>"`]*)?|(?:https?://)?app\.notion\.com(?:/[^\s)\]>"`]*)?}i;
  sub scrub { my $l = shift;
    $l =~ s{\[([^\]]*)\]\(\s*$U\s*\)}{$1}g;
    $l =~ s{$U}{[Notion link removed]}g;
    1 while $l =~ s{(notion.{0,40}?)$H}{$1\[id removed\]}is;
    1 while $l =~ s{$H(?=.{0,40}?notion)}{[id removed]}is;
    return $l; }'

notion_ref() {
  perl -e "$NOTION_PERL"'; my $hit = 0; while (my $l = <STDIN>) { $hit = 1 if scrub($l) ne $l } exit($hit ? 0 : 1)'
}

notion_scrub() {
  perl -e "$NOTION_PERL"'; while (my $l = <STDIN>) { print scrub($l) }'
}

gh_write() {
  local -a args=()
  local value temp=""
  while [ $# -gt 0 ]; do
    case $1 in
      -F|--body-file)
        temp=$(mktemp)
        if [ "$2" = - ]; then notion_scrub; else notion_scrub < "$2"; fi > "$temp"
        args+=("$1" "$temp")
        shift 2
        ;;
      *)
        value=$(printf '%s\n' "$1" | notion_scrub)
        args+=("$value")
        shift
        ;;
    esac
  done
  ${GH_CMD:-gh} "${args[@]}"
  local rc=$?
  [ -n "$temp" ] && rm -f "$temp"
  return $rc
}
