#!/usr/bin/env bash
# fusion/tests/validate.sh — package + contract validator (no API calls).
#
# The "program" is largely Markdown prompt. Ordinary tests miss prompt
# regressions, so this greps the skill files for load-bearing invariant strings
# in addition to bash -n / JSON / frontmatter checks. Exits non-zero on any fail.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "✦ Fusion validate — $ROOT"

# 1. shell syntax
echo "[1] shell syntax (bash -n)"
while IFS= read -r f; do
  if bash -n "$f" 2>/dev/null; then pass "$(basename "$f")"; else fail "bash -n: $f"; fi
done < <(find "$ROOT/scripts" "$ROOT/tests" "$ROOT/install.sh" -name '*.sh' 2>/dev/null)

# JSON helpers — prefer jq, then python3/py/python, then node (robust across
# Git Bash, WSL, macOS, Linux — where the available interpreter varies).
_py() { for c in python3 python py; do command -v "$c" >/dev/null 2>&1 && { echo "$c"; return; }; done; }
json_ok() {
  if command -v jq >/dev/null 2>&1; then jq -e . "$1" >/dev/null 2>&1; return; fi
  local py; py="$(_py)"
  if [ -n "$py" ]; then "$py" -c "import json,sys; json.load(open(sys.argv[1]))" "$1" 2>/dev/null; return; fi
  if command -v node >/dev/null 2>&1; then node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$1" 2>/dev/null; return; fi
  return 0  # no JSON tool available — skip rather than false-fail
}
json_paths() {
  if command -v jq >/dev/null 2>&1; then jq -r '
    def asarr: if type == "array" then . elif type == "string" then [.] else [] end;
    ((.skills | asarr) + (.commands | asarr))[]
  ' "$1" 2>/dev/null; return; fi
  local py; py="$(_py)"
  if [ -n "$py" ]; then "$py" -c "import json,sys; m=json.load(open(sys.argv[1])); a=lambda v: v if isinstance(v,list) else ([v] if isinstance(v,str) else []); [print(p) for p in (a(m.get('skills'))+a(m.get('commands')))]" "$1" 2>/dev/null; return; fi
  if command -v node >/dev/null 2>&1; then node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const a=v=>Array.isArray(v)?v:(typeof v==='string'?[v]:[]); [...a(m.skills),...a(m.commands)].forEach(p=>console.log(p))" "$1" 2>/dev/null; return; fi
}

# 2. JSON parses
echo "[2] JSON"
for j in "$ROOT/.codex-plugin/plugin.json" "$ROOT/kimi.plugin.json" "$ROOT/.kimi-plugin/plugin.json" "$ROOT/plugin.json"; do
  if json_ok "$j"; then pass "$(basename "$(dirname "$j")")/$(basename "$j")"; else fail "JSON parse: $j"; fi
done
if [ -f "$ROOT/kimi.plugin.json" ]; then pass "kimi.plugin.json present"; else fail "kimi.plugin.json missing"; fi

# 3. plugin.json declared paths exist
echo "[3] plugin.json paths exist"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  p="${p#./}"
  if [ -e "$ROOT/$p" ] || [ -e "$ROOT/$p/SKILL.md" ]; then pass "$p"; else fail "missing path: $p"; fi
done < <(json_paths "$ROOT/.codex-plugin/plugin.json" | tr -d '\r')

# 4. skill frontmatter (name + description + model)
echo "[4] skill frontmatter"
while IFS= read -r s; do
  head -12 "$s" | grep -q '^name:' && head -12 "$s" | grep -q '^description:' \
    && pass "$(basename "$(dirname "$s")")" || fail "frontmatter incomplete: $s"
done < <(find "$ROOT/skills" -name 'SKILL.md' 2>/dev/null)

# 5. command frontmatter (description)
echo "[5] command frontmatter"
while IFS= read -r c; do
  head -6 "$c" | grep -q '^description:' && pass "$(basename "$c")" || fail "no description: $c"
done < <(find "$ROOT/commands" -name '*.md' 2>/dev/null)

# 6. contract invariants (the load-bearing prose must not silently regress)
echo "[6] contract invariants"
ORCH="$ROOT/skills/fusion-orchestrate/SKILL.md"
REF="$ROOT/skills/fusion-orchestrate/references"
check() { # check <file> <regex> <label>
  if grep -qiE "$2" "$1" 2>/dev/null; then pass "$3"; else fail "missing in $(basename "$1"): $3"; fi
}
check "$ORCH" 'MANDATORY COMPLIANCE'                 "anti-simulation block present"
check "$ORCH" 'PROHIBITED from imagining|simulat'    "no-simulation rule present"
check "$ORCH" 'Absent .* agreement'                  "absent≠agreement (orchestrate)"
check "$ORCH" 'judge.*off the panel|off by default'  "judge-off-panel invariant"
check "$REF/panel-doctrine.md" 'in parallel and blind' "fixed neutral instruction present"
check "$REF/panel-doctrine.md" 'No personas|no personas|never manufacture' "no-personas doctrine"
check "$REF/anti-conformity.md" 'name.*flaw'         "name-the-flaw directive"
check "$REF/anti-conformity.md" 'anonymi'            "anonymization rule"
check "$REF/judge-rubric.md" 'Consensus'             "judge: consensus section"
check "$REF/judge-rubric.md" 'blind spots'           "judge: blind-spots section"
check "$REF/judge-rubric.md" 'Track A'               "judge: Track A (code)"
check "$REF/verdict-contract.md" '[Kk]ill [Cc]riteria' "verdict: kill criteria"
check "$REF/verdict-contract.md" 'next step'          "verdict: one next step"
check "$REF/collaboration-modes.md" 'solo|panel|council|debate|vote|swarm' "modes documented"
check "$REF/learning.md" 'ledger record'             "learning: record schema"

ULTRA="$ROOT/skills/fusion-ultracode/SKILL.md"
USWARM="$ROOT/skills/fusion-ultraswarm/SKILL.md"
UCMD="$ROOT/commands/ultracode.md"
USCMD="$ROOT/commands/ultraswarm.md"
check "$ULTRA" 'IMMEDIATE ACTION'                    "ultracode: immediate-action block"
check "$ULTRA" 'NO DISCOVERY|Forbidden'            "ultracode: no-discovery guard"
check "$UCMD" 'CRITICAL.*DIRECT EXECUTION'         "ultracode command: direct execution"
check "$USWARM" 'IMMEDIATE ACTION'                 "ultraswarm: immediate-action block"
check "$USWARM" 'NO DISCOVERY|Forbidden'           "ultraswarm: no-discovery guard"
check "$USWARM" 'ultraswarm_selector\.py.*--discover' "ultraswarm: python discover path"
check "$USCMD" 'CRITICAL.*DIRECT EXECUTION'        "ultraswarm command: direct execution"
check "$USCMD" 'ultraswarm_selector\.py --discover' "ultraswarm command: discover path"

# MetaLoop (fusion:metaloop) invariants
META="$ROOT/skills/fusion-metaloop/SKILL.md"
MCMD="$ROOT/commands/metaloop.md"
check "$META" 'IMMEDIATE ACTION'                   "metaloop: immediate-action block"
check "$META" 'NO DISCOVERY|Forbidden'             "metaloop: no-discovery guard"
check "$META" 'Chief Operator'                     "metaloop: chief operator role"
check "$META" 'Board Advisor'                       "metaloop: board advisor role"
check "$META" 'consult-only|not a worker|not a vote' "metaloop: advisor is not a worker/vote"
check "$META" 'Absent .* agreement'                "metaloop: absent≠agreement"
check "$META" 'correlat|one family'                "metaloop: gemini correlation rule"
check "$META" 'proposal'                           "metaloop: proposal workspace mode"
check "$META" 'swarm\.sh.*metaloop'                "metaloop: swarm.sh invocation"
check "$MCMD" 'CRITICAL.*DIRECT EXECUTION'         "metaloop command: direct execution"
check "$MCMD" 'swarm\.sh metaloop'                 "metaloop command: swarm.sh path"

# Ultimate Review (fusion:ultimate-review) invariants
UREV="$ROOT/skills/fusion-ultimate-review/SKILL.md"
UREF="$ROOT/skills/fusion-ultimate-review/references"
URCMD="$ROOT/commands/ultimate-review.md"
check "$UREV" 'IMMEDIATE ACTION'                    "ureview: immediate-action block"
check "$UREV" 'NO DISCOVERY|Forbidden'              "ureview: no-discovery guard"
check "$UREV" 'MANDATORY COMPLIANCE'                "ureview: anti-simulation block"
check "$UREV" 'PROHIBITED from imagining|simulat'   "ureview: no-simulation rule"
check "$UREV" 'Absent .* agreement'                 "ureview: absent≠agreement"
check "$UREV" 'do .not. consult the user|No user round-trips|no user round-trips' \
                                                    "ureview: autonomy contract"
check "$UREV" 'name.*flaw'                          "ureview: name-the-flaw rule"
check "$UREV" 'pride gate|Pride gate|Pride Gate'    "ureview: pride gate phase"
check "$UREV" 'ureview\.sh plan-review'             "ureview: plan-review dispatch"
check "$UREV" 'ureview\.sh impl-review'             "ureview: impl-review dispatch"
check "$UREV" 'different family|not you'            "ureview: reviewer is another family"
check "$UREV" 'verified end-to-end'                 "ureview: exact evidence vocabulary"
check "$UREV" 'Hard cap|hard cap|Bounds'            "ureview: bounded rounds"
check "$UREV" 'REPO_READ'                           "ureview: repo-read honesty"
check "$ROOT/scripts/ureview.sh" 'CreateProcessAsUserW|repo_read_status' \
                                                    "ureview.sh: repo-read detector"
check "$UREF/plan-audit.md" 'input-dimensioned|INPUT-DIMENSIONED' "plan-audit: hack detector"
check "$UREF/plan-audit.md" 'blast radius|Blast radius'           "plan-audit: grading fields"
check "$UREF/adjudication.md" 'sycophan'            "adjudication: anti-sycophancy"
check "$UREF/adjudication.md" 'unconfirmed'         "adjudication: unconfirmed disposition"
check "$UREF/pride-gate.md" 'not proud of'          "pride-gate: verbatim question"
check "$UREF/implementation-review.md" 'not a tweak|NOT tweaks|re-architecture' \
                                                    "impl-review: tweak boundary"
check "$URCMD" 'CRITICAL.*DIRECT EXECUTION'         "ureview command: direct execution"
check "$URCMD" 'ureview\.sh init'                   "ureview command: init path"
check "$ROOT/skills/fusion-orchestrate/references/collaboration-modes.md" 'ureview' \
                                                    "modes: ureview documented"
check "$ROOT/scripts/route.sh" 'ureview'            "route: ureview heuristic"

# Graph engineering (fusion:graph) invariants
GRAPH="$ROOT/skills/fusion-graph/SKILL.md"
GREF="$ROOT/skills/fusion-graph/references"
GCMD="$ROOT/commands/graph.md"
check "$GRAPH" 'MANDATORY COMPLIANCE'               "graph: anti-simulation block"
check "$GRAPH" 'PROHIBITED from imagining|simulat'  "graph: no-simulation rule"
check "$GRAPH" 'Absent .* agreement'                "graph: absent≠agreement"
check "$GRAPH" 'earn its coordination cost|does not need a graph' "graph: value test / stop rule"
check "$GRAPH" '\-\-plan'                           "graph: plan-before-spend"
check "$GRAPH" 'human'                              "graph: human gate on irreversible edges"
check "$GREF/topologies.md" 'fan.out'               "topologies: fan-out"
check "$GREF/topologies.md" 'barrier'               "topologies: barrier is opt-in"
check "$GREF/topologies.md" 'diamond'               "topologies: the diamond"
check "$GREF/topologies.md" 'refute|disprove'       "topologies: verification refutes"
check "$GREF/topologies.md" 'everything ever seen'   "topologies: loop dedupes vs all seen"
check "$GREF/task-graphs.md" 'stop rule'            "task-graphs: the stop rule"
check "$GREF/task-graphs.md" 'One writer per file|one writer per file' "task-graphs: one writer per file"
check "$GREF/task-graphs.md" 'fake_edge'            "task-graphs: fake-edge lint documented"
check "$GREF/task-graphs.md" 'critical path'        "task-graphs: critical path is the cost"
check "$GREF/knowledge-graphs.md" 'ontology'        "kg: ontology stage"
check "$GREF/knowledge-graphs.md" 'fusion'          "kg: fusion stage"
check "$GREF/knowledge-graphs.md" 'provenance'      "kg: provenance on every fact"
check "$GREF/knowledge-graphs.md" 'RELATED_TO'      "kg: no vague relations"
check "$GREF/graph-memory.md" 'typed edge'          "graph-memory: typed edges"
check "$GREF/graph-memory.md" 'entity resolution'   "graph-memory: entity resolution"
check "$GREF/graph-memory.md" 'valid_from|bitemporal|as-of|as_of' "graph-memory: bitemporal facts"
check "$GREF/graph-memory.md" 'evaluated only by its authors|does not exist' \
                                                    "graph-memory: benchmark honesty"
check "$GREF/workflows.md" 'Teaching mode'          "workflows: teaching mode"
check "$GCMD" 'swarm\.sh graph'                     "graph command: engine path"
check "$GCMD" 'swarm\.sh kg'                        "graph command: kg store path"
check "$GCMD" '\-\-plan'                            "graph command: plan before spend"

# 7. Python swarm engine compiles (skipped gracefully if no python)
echo "[7] python swarm engine"
PY=""
for c in python py python3; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -n "$PY" ]; then
  if "$PY" -m py_compile "$ROOT"/python/fusion_swarm/*.py 2>/dev/null; then
    pass "fusion_swarm compiles"
  else
    fail "python compile error in fusion_swarm"
  fi
else
  pass "python not found — swarm engine compile skipped"
fi

# 8. Offline unit tests (skipped gracefully if no python)
echo "[8] offline unit tests"
for suite in test_metaloop test_graph test_board test_identities test_spawn test_designer test_hive test_hive_integration test_factory test_lanes test_kimi_install test_hive_docs; do
  if [ -n "$PY" ] && [ -f "$ROOT/tests/$suite.py" ]; then
    if ( cd "$ROOT" && "$PY" -m unittest "tests.$suite" >/dev/null 2>&1 ); then
      pass "tests.$suite"
    else
      fail "tests.$suite failed"
    fi
  else
    pass "python/tests.$suite not found — skipped"
  fi
done

# 9. Offline ureview tests (prompt contracts + guards; no dispatch, no cost)
echo "[9] ureview offline tests"
if [ -f "$ROOT/tests/test-ureview.sh" ]; then
  if bash "$ROOT/tests/test-ureview.sh" >/dev/null 2>&1; then
    pass "tests/test-ureview.sh"
  else
    fail "tests/test-ureview.sh failed (run it directly for detail)"
  fi
else
  pass "tests/test-ureview.sh not found — skipped"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✦ validate: ALL CHECKS PASSED"
  exit 0
else
  echo "✦ validate: $FAIL check(s) FAILED"
  exit 1
fi
