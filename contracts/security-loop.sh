#!/bin/bash

# Security Review Loop Script v3
# - Runs security review in fresh context
# - Fixes in SAME context (using --continue)
# - Repeats until 3 consecutive clean runs

# Configuration
REQUIRED_CLEAN_RUNS=3
LOG_DIR="security-logs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check that claude command exists
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: 'claude' command not found${NC}"
    echo "Please install Claude Code CLI"
    exit 1
fi

# Initialize
clean_count=0
run_count=0
start_time=$(date +%s)

# Create log directory
mkdir -p "$SCRIPT_DIR/$LOG_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Security Review Loop v3${NC}"
echo -e "${BLUE}  Target: $REQUIRED_CLEAN_RUNS consecutive clean runs${NC}"
echo -e "${BLUE}  Fix mode: Same context (--continue)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Main loop
while [ $clean_count -lt $REQUIRED_CLEAN_RUNS ]; do
    run_count=$((run_count + 1))
    review_file="$SCRIPT_DIR/$LOG_DIR/review-$run_count.txt"
    fix_file="$SCRIPT_DIR/$LOG_DIR/fix-$run_count.txt"

    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  Run #$run_count (Clean streak: $clean_count/$REQUIRED_CLEAN_RUNS)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Step 1: Run security review (NEW session each iteration)
    echo -e "${BLUE}[$(date '+%H:%M:%S')] Running security review (fresh context)...${NC}"
    echo ""

    cd "$SCRIPT_DIR"
    claude -p --dangerously-skip-permissions "/security-review" 2>&1 | tee "$review_file"

    echo ""
    echo -e "${BLUE}[$(date '+%H:%M:%S')] Analyzing output...${NC}"

    # Step 2: Check for vulnerabilities
    vuln_count=$(grep -cE "^#+ Vuln [0-9]+" "$review_file" 2>/dev/null || true)

    if [ -z "$vuln_count" ]; then
        vuln_count=0
    fi

    if [ "$vuln_count" -gt 0 ]; then
        # Vulnerabilities found - fix in SAME context
        echo -e "${RED}[$(date '+%H:%M:%S')] Found $vuln_count vulnerabilities${NC}"
        echo ""
        echo -e "${YELLOW}[$(date '+%H:%M:%S')] Fixing in same context (--continue)...${NC}"
        echo ""

        # Step 3: Fix using --continue (SAME SESSION!)
        claude -p -c --dangerously-skip-permissions "fix all vulnerabilities" 2>&1 | tee "$fix_file"

        echo ""
        echo -e "${GREEN}[$(date '+%H:%M:%S')] Fix complete${NC}"
        clean_count=0  # Reset streak

    else
        # No vulnerabilities - increment clean streak
        clean_count=$((clean_count + 1))
        echo -e "${GREEN}[$(date '+%H:%M:%S')] No vulnerabilities found!${NC}"
        echo -e "${GREEN}[$(date '+%H:%M:%S')] Clean streak: $clean_count/$REQUIRED_CLEAN_RUNS${NC}"
    fi

    echo ""

    if [ $clean_count -ge $REQUIRED_CLEAN_RUNS ]; then
        break
    fi

    echo -e "${BLUE}[$(date '+%H:%M:%S')] Starting next iteration (fresh context)...${NC}"
    echo ""
    sleep 2
done

# Calculate duration
end_time=$(date +%s)
duration=$((end_time - start_time))
hours=$((duration / 3600))
minutes=$(((duration % 3600) / 60))
seconds=$((duration % 60))

# Summary
summary_file="$SCRIPT_DIR/$LOG_DIR/summary.txt"
{
    echo "Security Review Loop Summary"
    echo "============================"
    echo "Completed: $(date)"
    echo "Total runs: $run_count"
    echo "Clean runs achieved: $clean_count"
    echo "Duration: ${hours}h ${minutes}m ${seconds}s"
    echo ""
    echo "Log files:"
    ls -la "$SCRIPT_DIR/$LOG_DIR"/*.txt 2>/dev/null
} | tee "$summary_file"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SUCCESS!${NC}"
echo -e "${GREEN}  $REQUIRED_CLEAN_RUNS consecutive clean reviews${NC}"
echo -e "${GREEN}  Total runs: $run_count${NC}"
echo -e "${GREEN}  Duration: ${hours}h ${minutes}m ${seconds}s${NC}"
echo -e "${GREEN}========================================${NC}"
