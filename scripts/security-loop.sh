#!/usr/bin/env bash
# ============================================================
# security-loop.sh - Iterative Security Review & Fix Loop
# ============================================================
# Runs security review → fixes findings → re-runs from scratch
# until a clean pass (0 HIGH/MEDIUM findings).
#
# Each iteration is a FRESH claude session (no leftover context).
#
# Usage:
#   ./scripts/security-loop.sh              # default: contracts/src/
#   ./scripts/security-loop.sh src/MyFile.sol
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-contracts/src/}"
MAX_ITERATIONS=10
LOG_DIR="$REPO_ROOT/.security-loop"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  Security Review Loop - $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}  Target: ${TARGET}${NC}"
echo -e "${CYAN}  Max iterations: ${MAX_ITERATIONS}${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

for i in $(seq 1 "$MAX_ITERATIONS"); do
    REVIEW_FILE="$LOG_DIR/review-iter-${i}.md"
    FIX_FILE="$LOG_DIR/fix-iter-${i}.md"

    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  ITERATION ${i}/${MAX_ITERATIONS} - REVIEW PHASE${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # ── Step 1: Build ──
    echo -e "${CYAN}[Step 1] Building contracts...${NC}"
    if ! (cd contracts && forge build 2>&1 | tail -3); then
        echo -e "${RED}BUILD FAILED - fix compilation errors first${NC}"
        exit 1
    fi
    echo ""

    # ── Step 2: Fresh security review ──
    echo -e "${CYAN}[Step 2] Running fresh security review...${NC}"

    REVIEW_PROMPT="Perform a FRESH security audit of all Solidity files in ${TARGET}.

Rules:
- Read every .sol file yourself. Do NOT assume anything.
- Only report HIGH/MEDIUM severity with confidence >= 8/10.
- Skip: gas optimizations, style, NatSpec, OpenZeppelin patterns, DoS-by-revert.
- Include exact file path and line number for each finding.
- Do NOT report .sol.bak or .disabled files.

YOUR FINAL OUTPUT must end with exactly one of these lines (nothing after it):
RESULT: CLEAN
RESULT: X FINDINGS

Where X is the number of issues found. This line MUST be the very last line of your output."

    claude -p \
        --allowedTools "Read Glob Grep Task mcp__rlm__rlm_load mcp__rlm__rlm_search mcp__rlm__rlm_chunk mcp__rlm__rlm_peek mcp__rlm__rlm_get mcp__rlm__rlm_list" \
        --dangerously-skip-permissions \
        "$REVIEW_PROMPT" \
        2>/dev/null | tee "$REVIEW_FILE"

    echo ""

    # ── Step 3: Parse results ──
    # Try multiple detection methods, most specific first

    # Method 1: Look for "RESULT: CLEAN" or "RESULT: N FINDINGS"
    if grep -q "RESULT: CLEAN" "$REVIEW_FILE" 2>/dev/null; then
        FINDING_COUNT=0
    elif RESULT_LINE=$(grep -o 'RESULT: [0-9]* FINDING' "$REVIEW_FILE" 2>/dev/null | head -1); then
        FINDING_COUNT=$(echo "$RESULT_LINE" | sed 's/[^0-9]//g')
    # Method 2: Look for "## FINDINGS: N"
    elif FINDINGS_LINE=$(grep '## FINDINGS:' "$REVIEW_FILE" 2>/dev/null | head -1); then
        FINDING_COUNT=$(echo "$FINDINGS_LINE" | sed 's/[^0-9]//g')
    # Method 3: Count unique VULN markers
    elif grep -q 'VULN-' "$REVIEW_FILE" 2>/dev/null; then
        FINDING_COUNT=$(grep -oE 'VULN-[0-9]+' "$REVIEW_FILE" | sort -u | wc -l | tr -d ' ')
    # Method 4: Look for severity keywords as evidence of findings
    elif grep -qiE '\*\*Severity\*\*.*\b(HIGH|MEDIUM)\b' "$REVIEW_FILE" 2>/dev/null; then
        FINDING_COUNT=$(grep -ciE '\*\*Severity\*\*.*\b(HIGH|MEDIUM)\b' "$REVIEW_FILE" 2>/dev/null || echo "1")
        echo -e "${YELLOW}Detected ${FINDING_COUNT} severity markers in output.${NC}"
    # Method 5: Check for "no.*vulnerabilit" or "clean" as evidence of NO findings
    elif grep -qiE 'no.*(vulnerabilit|issues|findings)|all contracts are clean' "$REVIEW_FILE" 2>/dev/null; then
        FINDING_COUNT=0
    else
        # DEFAULT: Assume findings exist (safer than assuming clean)
        echo -e "${YELLOW}Could not parse finding count. Assuming findings exist.${NC}"
        FINDING_COUNT=1
    fi

    echo -e "${CYAN}Parsed finding count: ${FINDING_COUNT}${NC}"

    if [[ "$FINDING_COUNT" == "0" ]]; then
        echo ""
        echo -e "${GREEN}============================================================${NC}"
        echo -e "${GREEN}  CLEAN PASS on iteration ${i}!${NC}"
        echo -e "${GREEN}  No HIGH or MEDIUM vulnerabilities found.${NC}"
        echo -e "${GREEN}============================================================${NC}"
        echo ""
        echo "Review logs saved in: $LOG_DIR/"
        exit 0
    fi

    echo -e "${RED}Found ${FINDING_COUNT} findings. Proceeding to fix phase...${NC}"
    echo ""

    # ── Step 4: Fix findings ──
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  ITERATION ${i}/${MAX_ITERATIONS} - FIX PHASE${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    REVIEW_CONTENT=$(cat "$REVIEW_FILE")

    FIX_PROMPT="A security review found vulnerabilities in the Solidity contracts. Fix ALL of them.

For each fix:
1. Read the contract file first (use Read tool)
2. Make the minimal targeted fix (use Edit tool)
3. Do NOT over-engineer
4. After ALL fixes, run: forge build (use Bash tool)
5. If build fails, fix compilation errors
6. Run: forge test (use Bash tool)
7. If tests fail, fix them too

CONSTRAINTS:
- Do NOT change ADMIN_TIMELOCK or EMERGENCY_APPROVAL_EXPIRY constants
- ZkAMMv3Router must stay under 24,576 bytes (EIP-170)
- Do NOT modify .sol.bak or .disabled files

Here are the findings:

${REVIEW_CONTENT}"

    claude -p \
        --dangerously-skip-permissions \
        "$FIX_PROMPT" \
        2>/dev/null | tee "$FIX_FILE"

    echo ""

    # ── Step 5: Verify ──
    echo -e "${CYAN}[Step 5] Verifying build after fixes...${NC}"
    if ! (cd contracts && forge build 2>&1 | tail -3); then
        echo -e "${RED}BUILD FAILED after fixes in iteration ${i}!${NC}"
        echo -e "${RED}Check $FIX_FILE for details. Manual intervention needed.${NC}"
        exit 1
    fi

    echo ""
    echo -e "${CYAN}[Step 5] Contract sizes:${NC}"
    (cd contracts && forge build --sizes 2>&1 | grep -E "ZkAMMv3Router|ZkAMMv3Admin|ZkAMMv3Pair|R00TShorts|ZkProjectPoolCore") || true
    echo ""

    # Check Router size
    ROUTER_SIZE=$(cd contracts && forge build --sizes 2>&1 | grep "ZkAMMv3Router" | awk '{print $4}' | tr -d ',' || echo "0")
    if [[ -n "$ROUTER_SIZE" ]] && [[ "$ROUTER_SIZE" -gt 0 ]] && [[ "$ROUTER_SIZE" -gt 24576 ]]; then
        echo -e "${RED}ROUTER EXCEEDS EIP-170 LIMIT (${ROUTER_SIZE} > 24576)!${NC}"
        exit 1
    fi

    # Verify tests
    echo -e "${CYAN}[Step 5] Running tests...${NC}"
    if ! (cd contracts && forge test 2>&1 | tail -5); then
        echo -e "${RED}TESTS FAILED after fixes in iteration ${i}!${NC}"
        echo -e "${RED}Manual intervention needed.${NC}"
        exit 1
    fi

    echo ""
    echo -e "${GREEN}Iteration ${i} complete. Starting fresh review...${NC}"
    echo ""
done

echo ""
echo -e "${RED}============================================================${NC}"
echo -e "${RED}  Reached max iterations (${MAX_ITERATIONS}) without clean pass!${NC}"
echo -e "${RED}  Review the logs in: $LOG_DIR/${NC}"
echo -e "${RED}============================================================${NC}"
exit 1
