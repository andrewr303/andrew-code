#!/usr/bin/env bash
# fusion/scripts/providers/_common.sh
# Shared helpers for every panelist adapter.
#
# Design rules (grounded in the source-repo pitfalls):
#   - Prompts are NEVER interpolated into a double-quoted command string. They are
#     passed via stdin or a --prompt-file, or as a single "$(cat file)" argument.
#   - Every external call runs under a portable timeout (Git Bash has no GNU `timeout`).
#   - Panelists run in a throwaway scratch dir; they never touch the user's tree.
#   - Exit-code contract is uniform across adapters:
#         0   = success (non-empty answer written to OUT)
#         127 = CLI not installed
#         124 = timed out
#         1   = runtime failure (auth / empty output / non-zero exit)
#
# This file is sourced, not executed.

# --- paths ------------------------------------------------------------------
fusion_provider_dir() { cd "$(dirname "${BASH_SOURCE[0]}")" && pwd; }

# Map host plugin option env vars to a FUSION_* env var, but only when the
# FUSION_* var isn't already set (an explicit shell env var always wins). The
# legacy Claude plugin used CLAUDE_PLUGIN_OPTION_*; the Codex plugin also checks
# CODEX_PLUGIN_OPTION_* if a future host exposes that convention.
fusion_apply_userconfig() {
  local target="$1" key="$2" lc uc cl cu val
  lc="CLAUDE_PLUGIN_OPTION_${key}"
  uc="CLAUDE_PLUGIN_OPTION_$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')"
  cl="CODEX_PLUGIN_OPTION_${key}"
  cu="CODEX_PLUGIN_OPTION_$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')"
  val="${!lc:-${!uc:-${!cl:-${!cu:-}}}}"
  if [ -z "${!target:-}" ] && [ -n "$val" ]; then export "$target=$val"; fi
}

# Config precedence: explicit FUSION_* env  >  defaults.env (if uncommented)  >
# host plugin option env vars  >  baked-in adapter defaults.
fusion_load_config() {
  local self_dir cfg
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
  cfg="${FUSION_CONFIG:-$self_dir/config/defaults.env}"
  [ -f "$cfg" ] && . "$cfg" 2>/dev/null || true
  fusion_apply_userconfig FUSION_CODEX_MODEL      codex_model
  fusion_apply_userconfig FUSION_CODEX_EFFORT     codex_effort
  fusion_apply_userconfig FUSION_COPILOT_MODEL    copilot_model
  fusion_apply_userconfig FUSION_OPENCODE_MODEL   opencode_model
  fusion_apply_userconfig FUSION_OPENCODE_VARIANT opencode_variant
  fusion_apply_userconfig FUSION_GROK_MODEL       grok_model
  fusion_apply_userconfig FUSION_ANDREWCODE_MODEL  andrewcode_model
  fusion_apply_userconfig FUSION_ANDREWCODE_EFFORT andrewcode_effort
  # MetaLoop (fusion:metaloop) providers: Fable advisor + Antigravity fast worker.
  fusion_apply_userconfig FUSION_FABLE_MODEL      fable_model
  fusion_apply_userconfig FUSION_FABLE_EFFORT     fable_effort
  fusion_apply_userconfig FUSION_AGY_MODEL        agy_model
}
fusion_load_config

# Convert a POSIX/Git-Bash path to a native Windows path for native .exe args.
# No-op on real POSIX systems (cygpath absent).
fusion_winpath() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p" 2>/dev/null || printf '%s' "$p"
  else
    printf '%s' "$p"
  fi
}

# --- scratch ----------------------------------------------------------------
fusion_mk_scratch() {
  local tag="${1:-fusion}"
  mktemp -d "${TMPDIR:-/tmp}/fusion-${tag}.XXXXXX"
}
fusion_rm_scratch() {
  local d="${1:-}"
  [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d" 2>/dev/null || true
}

# --- repo snapshot (MetaLoop proposal-mode real-repo READ) ------------------
# The blind-panel adapters deliberately run in an EMPTY scratch dir. MetaLoop
# WORKERS instead must READ the codebase — so they get a populated per-worker
# snapshot: a disposable copy of the repo placed inside their scratch. This
# fixes the "empty sandbox can't see the repo" failure while preserving the
# no-user-tree-write invariant (a worker edits only its copy; the host
# reconciles the returned diff) and staying safe under concurrency (each worker
# gets its own copy) and git-optional.
#
# Opt-in: only runs when FUSION_WORKER_REPO (or the passed <src>) is a real dir.
# Blind panel modes pass nothing and keep their empty scratch untouched.
#
# Usage: fusion_snapshot_repo <src_repo> <dest_dir> [scope_path ...]
#   git repo  -> copies tracked files (respects .gitignore), optionally scoped.
#   non-git   -> copies files, skipping heavy/binary dirs, with count/size caps.
# Caps (env): FUSION_SNAPSHOT_MAX_FILES (default 4000),
#             FUSION_SNAPSHOT_MAX_FILE_KB (default 512).
# Writes <dest>/.fusion-snapshot.txt recording base + any omissions (honesty).
fusion_snapshot_repo() {
  local src="$1" dest="$2"; shift 2 2>/dev/null || true
  [ -n "$src" ] && [ -d "$src" ] || return 1
  mkdir -p "$dest" 2>/dev/null || return 1
  local max_files="${FUSION_SNAPSHOT_MAX_FILES:-4000}"
  local max_kb="${FUSION_SNAPSHOT_MAX_FILE_KB:-512}"
  local n=0 skipped=0 base="(non-git)" f kb rel
  local scope=("$@")

  if command -v git >/dev/null 2>&1 && git -C "$src" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    base="$(git -C "$src" rev-parse --short HEAD 2>/dev/null || echo '(no-commit)')"
    while IFS= read -r -d '' f; do
      [ "$n" -ge "$max_files" ] && { skipped=$((skipped+1)); continue; }
      kb=$(( ( $(wc -c < "$src/$f" 2>/dev/null || echo 0) + 1023 ) / 1024 ))
      [ "$kb" -gt "$max_kb" ] && { skipped=$((skipped+1)); continue; }
      mkdir -p "$dest/$(dirname "$f")" 2>/dev/null
      cp "$src/$f" "$dest/$f" 2>/dev/null && n=$((n+1)) || skipped=$((skipped+1))
    done < <( cd "$src" && git ls-files -z -- "${scope[@]}" 2>/dev/null )
  else
    local excl='/(\.git|node_modules|__pycache__|\.venv|venv|dist|build|\.omc|\.next|target|vendor)/|\.(pyc|png|jpe?g|gif|pdf|zip|gz|tgz|exe|dll|so|dylib|bin|ico|woff2?|mp4|mov)$'
    while IFS= read -r -d '' f; do
      [ "$n" -ge "$max_files" ] && { skipped=$((skipped+1)); continue; }
      rel="${f#"$src"/}"
      printf '/%s\n' "$rel" | grep -qiE "$excl" && { skipped=$((skipped+1)); continue; }
      kb=$(( ( $(wc -c < "$f" 2>/dev/null || echo 0) + 1023 ) / 1024 ))
      [ "$kb" -gt "$max_kb" ] && { skipped=$((skipped+1)); continue; }
      mkdir -p "$dest/$(dirname "$rel")" 2>/dev/null
      cp "$f" "$dest/$rel" 2>/dev/null && n=$((n+1)) || skipped=$((skipped+1))
    done < <( find "$src" -type f -print0 2>/dev/null )
  fi

  {
    echo "# fusion repo snapshot (proposal-mode read copy — writes here never touch the user tree)"
    echo "source: $src"
    echo "base: $base"
    echo "files_copied: $n"
    echo "files_skipped: $skipped (caps: ${max_files} files, ${max_kb}KB/file; heavy/binary dirs excluded)"
  # git ls-files is alphabetical, so a hit file-cap silently drops the LAST
  # directories (observed live: src/ + supabase/ missing). Tell the worker
  # loudly, in a file it will see first, with the read-only fallback path.
  if [ "$skipped" -gt 0 ]; then
    {
      echo "# SNAPSHOT TRUNCATED"
      echo ""
      echo "$skipped file(s) were EXCLUDED from this snapshot (cap: ${max_files} files, ${max_kb}KB/file)."
      echo "Directories sorting late (e.g. src/, supabase/) may be missing entirely."
      echo ""
      echo "Fallback: read the ORIGINAL checkout READ-ONLY at: $src"
      echo "Never write to that path - propose changes in your reply only."
    } > "$dest/SNAPSHOT-TRUNCATED.md" 2>/dev/null || true
  fi
    [ "${#scope[@]}" -gt 0 ] && echo "scope: ${scope[*]}"
  } > "$dest/.fusion-snapshot.txt" 2>/dev/null || true
  return 0
}

# Resolve the repo a MetaLoop worker should snapshot for READ context.
# Precedence: explicit arg > FUSION_WORKER_REPO env > empty (blind panel mode).
fusion_worker_repo() {
  local arg="${1:-}"
  if [ -n "$arg" ] && [ -d "$arg" ]; then printf '%s' "$arg"; return 0; fi
  if [ -n "${FUSION_WORKER_REPO:-}" ] && [ -d "${FUSION_WORKER_REPO}" ]; then
    printf '%s' "$FUSION_WORKER_REPO"; return 0
  fi
  printf ''
}

# Hand a (possibly large) prompt to an agentic CLI without ever overflowing argv
# (the E2BIG "Argument list too long" failure). Small prompts pass inline; large
# prompts are written into the worker's workspace as .fusion-task.md and replaced
# by a short pointer the agent reads from its own cwd. Because MetaLoop workers
# now READ the repo directly, prompts are normally small and stay inline.
# Echoes the exact string to pass as the CLI's prompt argument.
# Usage: prompt_text="$(fusion_prompt_text <prompt_file> <workspace_dir>)"
fusion_prompt_text() {
  local pf="$1" ws="${2:-}" bytes cap
  cap="${FUSION_PROMPT_INLINE_MAX:-16000}"
  bytes=$(wc -c < "$pf" 2>/dev/null || echo 0)
  if [ "$bytes" -le "$cap" ] || [ -z "$ws" ] || [ ! -d "$ws" ]; then
    cat "$pf"
    return 0
  fi
  cp "$pf" "$ws/.fusion-task.md" 2>/dev/null || { cat "$pf"; return 0; }
  printf 'Your full task specification is in the file ".fusion-task.md" in your current working directory. Read that file completely, then complete exactly the task it describes. Return only the output that file requires.'
}

# --- portable timeout -------------------------------------------------------
# Usage: fusion_timeout <seconds> <fn-name> [args...]
# The function <fn-name> performs its own redirections (stdin/stdout/files).
# Returns 124 if the call was killed for exceeding the wall-clock budget.
fusion_timeout() {
  local secs="$1"; shift
  local fn="$1"; shift
  # Sentinel marker: the watcher creates it iff IT fired the kill. We then know a
  # 124 is a real timeout, not an unrelated 143/137 (OOM-kill, outer SIGTERM, etc.).
  local marker; marker="$(mktemp -u "${TMPDIR:-/tmp}/fusion-to.XXXXXX" 2>/dev/null || echo "${TMPDIR:-/tmp}/fusion-to.$$")"
  "$fn" "$@" &
  local pid=$!
  ( sleep "$secs" 2>/dev/null
    : > "$marker" 2>/dev/null
    kill -TERM "$pid" 2>/dev/null
    sleep 3 2>/dev/null
    kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  kill -TERM "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  if [ -f "$marker" ]; then
    rm -f "$marker" 2>/dev/null
    return 124
  fi
  rm -f "$marker" 2>/dev/null
  return "$rc"
}

# --- result hygiene ---------------------------------------------------------
# Strip terminal control chars / spinner noise some CLIs leak into stdout.
fusion_clean_output() {
  local f="$1"
  [ -s "$f" ] || return 0
  # remove ANSI escapes and carriage returns
  sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g' -e 's/\r$//' "$f" > "$f.clean" 2>/dev/null \
    && mv "$f.clean" "$f" 2>/dev/null || true
}

# Emit a uniform failure note to stderr (kept short; never prints secrets).
fusion_fail() {
  local provider="$1" rc="$2" logfile="${3:-}"
  echo "[fusion] ${provider} failed (rc=${rc})" >&2
  if [ -n "$logfile" ] && [ -s "$logfile" ]; then
    tail -n 6 "$logfile" 2>/dev/null | sed 's/^/[fusion]   /' >&2 || true
  fi
}
