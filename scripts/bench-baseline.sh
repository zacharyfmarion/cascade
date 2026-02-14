#!/usr/bin/env bash
#
# bench-baseline.sh - Save or compare Criterion benchmark baselines
#
# Usage:
#   ./scripts/bench-baseline.sh save [name]     Save a baseline (default: "main")
#   ./scripts/bench-baseline.sh compare [name]  Compare current against baseline (default: "main")
#   ./scripts/bench-baseline.sh run             Run benchmarks without saving
#   ./scripts/bench-baseline.sh report          Open the latest HTML report
#
# Examples:
#   # On main branch, save baseline:
#   git checkout main
#   ./scripts/bench-baseline.sh save main
#
#   # On feature branch, compare:
#   git checkout my-feature
#   ./scripts/bench-baseline.sh compare main
#
#   # Quick run without baseline:
#   ./scripts/bench-baseline.sh run
#
#   # Run only specific benchmark groups:
#   BENCH_FILTER="color" ./scripts/bench-baseline.sh run
#   BENCH_FILTER="filter_gaussian" ./scripts/bench-baseline.sh compare main

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_ROOT/target/criterion"
BENCH_PACKAGE="compositor-nodes-std"

# Optional filter: only run benchmarks matching this pattern
BENCH_FILTER="${BENCH_FILTER:-}"

cd "$PROJECT_ROOT"

usage() {
    sed -n '3,/^$/s/^# \?//p' "$0"
    exit 1
}

run_bench() {
    local extra_args=("$@")
    local cmd=(cargo bench -p "$BENCH_PACKAGE")

    if [ -n "$BENCH_FILTER" ]; then
        cmd+=(-- "$BENCH_FILTER")
    fi

    cmd+=("${extra_args[@]}")

    echo "Running: ${cmd[*]}"
    echo ""
    "${cmd[@]}"
}

cmd_save() {
    local name="${1:-main}"
    echo "=== Saving baseline: $name ==="
    echo ""
    run_bench -- --save-baseline "$name"
    echo ""
    echo "Baseline '$name' saved to $REPORT_DIR/"
    echo "To compare later: ./scripts/bench-baseline.sh compare $name"
}

cmd_compare() {
    local name="${1:-main}"
    echo "=== Comparing against baseline: $name ==="
    echo ""
    run_bench -- --baseline "$name"
    echo ""
    echo "Results compared against baseline '$name'"
    echo "HTML report: $REPORT_DIR/report/index.html"
}

cmd_run() {
    echo "=== Running benchmarks ==="
    echo ""
    run_bench
    echo ""
    echo "HTML report: $REPORT_DIR/report/index.html"
}

cmd_report() {
    local report="$REPORT_DIR/report/index.html"
    if [ ! -f "$report" ]; then
        echo "No report found. Run benchmarks first:"
        echo "  ./scripts/bench-baseline.sh run"
        exit 1
    fi
    echo "Opening: $report"
    open "$report" 2>/dev/null || xdg-open "$report" 2>/dev/null || echo "Report at: $report"
}

case "${1:-}" in
    save)    cmd_save "${2:-main}" ;;
    compare) cmd_compare "${2:-main}" ;;
    run)     cmd_run ;;
    report)  cmd_report ;;
    *)       usage ;;
esac
