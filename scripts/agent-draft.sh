#!/bin/sh
# Start an AI CLI in this tmux pane with a draft in its input box, without pressing Enter: the owner
# finishes the sentence there. The dock runs it for an extension panel's "Update" (spec 001).
#
#   sh scripts/agent-draft.sh claude|codex 'Update extension Gym (extensions/gym): '
#
# Keys typed before the CLI is up would land in the shell (or be echoed by it), so a helper waits until the
# CLI has switched the terminal to raw mode (stty shows -icanon), gives its input box a moment to mount,
# then types the draft with tmux send-keys.
agent=$1
draft=$2
case $agent in
  claude | codex) ;;
  *) echo "usage: sh scripts/agent-draft.sh claude|codex <draft>" >&2 && exit 2 ;;
esac

if [ -n "$TMUX_PANE" ] && [ -n "$draft" ]; then
  pane=$TMUX_PANE
  tty=$(tty)
  (
    i=0
    while [ $i -lt 120 ]; do # up to 30 s
      sleep 0.25
      i=$((i + 1))
      stty -a <"$tty" 2>/dev/null | grep -q -- '-icanon' && break
    done
    [ $i -lt 120 ] || exit 0
    sleep "${AGENT_DRAFT_SETTLE:-1.5}"
    tmux send-keys -t "$pane" -l -- "$draft"
  ) >/dev/null 2>&1 &
fi
exec "$agent"
