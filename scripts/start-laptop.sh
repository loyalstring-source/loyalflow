#!/usr/bin/env bash
# Start LoyalFlow on a laptop (macOS/Linux) with demo data. Needs Node 22.18 or newer: https://nodejs.org
set -e
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js 22 (LTS) from https://nodejs.org first."; exit 1; fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node 22 or newer is required (you have $(node -v))."; exit 1; fi
[ -d node_modules ] || npm install --no-audit --no-fund
export LOYALFLOW_DEMO=${LOYALFLOW_DEMO:-1}
export PORT=${PORT:-3000}
echo "Starting LoyalFlow on http://localhost:$PORT (demo data: $LOYALFLOW_DEMO)"
echo "Sign in as sridhar.narayanagowda@loyalstring.com / Welcome@LoyalFlow1"
node --no-warnings=ExperimentalWarning src/server.ts
