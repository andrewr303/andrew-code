# Panel doctrine — how to prompt the panel

The single most important rule of Fusion: **harvest diversity from independent runs; never
manufacture it with personas.** Two cold runs of different models already diverge in
reasoning path, tool calls, and sources. That divergence is *real signal*. The moment you
assign a panelist a "lens" or a "role," its agreements and disagreements become artifacts
of the costume you handed it, and the whole confidence signal collapses.

## The rules
1. **Task verbatim.** Each panelist gets the user's task exactly as written — you do not
   pre-digest, reframe, decompose, or pre-solve it for them. (Exception: `swarm`, where the
   subtask *is* the decomposition; and you must paste local file context the panelist can't
   see.)
2. **One fixed neutral instruction**, appended identically to every panelist. No more.
3. **No personas, lenses, or assigned stances** — except in `debate`, where opposing
   positions are the explicit, adversarial point.
4. **Blind.** Panelists never see each other's answers, except in deliberate, anonymized
   council/debate rounds.
5. **Isolation.** Panelists run in throwaway scratch dirs. They **cannot see this repo.**
   For any task touching local files, paste the relevant contents into the prompt or
   disclose in the audit trail that the panel judged without repo access.

## The fixed neutral instruction (append verbatim)

> Answer the task above completely and independently. You have web search and a shell;
> use them to verify facts, read primary sources, and — for code or other runnable
> artifacts — actually run and test what you produce rather than reasoning about it from
> memory. Do not modify any shared working tree; experiment only in scratch files or a
> temp directory. Ground every claim in evidence and state your confidence honestly,
> flagging anything you could not verify. You are one of several models answering this
> same task in parallel and blind; do not address, imagine, or coordinate with the
> others — just give your own best, complete answer. Return only that final answer.

## Building the prompt file
Write the panel prompt to a temp file (never interpolate it into a shell command — the
adapters handle injection-safe delivery via stdin / `--prompt-file`):

```
TASK (verbatim):
<the user's task, exactly>

<-- if the task references local files, paste the relevant excerpts here, fenced -->

INSTRUCTION:
<the fixed neutral instruction above, verbatim>
```

Then: `fusion.sh panel "$PROMPT_FILE" "$OUT_DIR"`.

## Tools are the whole point
The benchmark is unambiguous: synthesis **beats** the best single model when panelists
have tools (different search trajectories → complementary evidence to fuse), and can
**lose** to the best single model when they don't (a strong judge just dilutes one good
answer with three weaker ones). Every adapter ships with web search on. If a task is
purely from-memory with no verifiable surface, fusion is the wrong tool — answer `solo`.

## Why even a same-model panel works
Running one model twice still produces different reasoning paths and tool calls — the
synthesis step alone adds real lift (~6.7 pts in the benchmark's self-fusion test). So
when only one external panelist is live, a panel of "that CLI + a Codex subagent" is
still a legitimate fusion, not a fallback to pretend about.
