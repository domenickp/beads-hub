#!/bin/bash
set -e

# ── Decrypt secrets if encrypted env file exists ──
if [ -f "/secrets/.env.enc" ] && [ -f "/secrets/age-key.txt" ]; then
  echo "[entrypoint] Decrypting secrets with SOPS/age..."
  export SOPS_AGE_KEY_FILE="/secrets/age-key.txt"

  # Decrypt to tmpfs (RAM-only, never hits disk)
  mkdir -p /tmp/secrets
  sops -d /secrets/.env.enc > /tmp/secrets/.env 2>/dev/null

  # Source the decrypted env vars
  set -a
  source /tmp/secrets/.env
  set +a

  echo "[entrypoint] Secrets loaded into environment"
elif [ -f "/app/.env" ]; then
  echo "[entrypoint] Using plaintext .env file"
  set -a
  source /app/.env
  set +a
else
  echo "[entrypoint] No .env or encrypted secrets found — using environment variables"
fi

# ── Initialize beads if needed ──
BEADS_DIR="${BEADS_PROJECT_DIR:-/data/beads-project}"
mkdir -p "$BEADS_DIR"
if [ ! -d "$BEADS_DIR/.beads" ]; then
  echo "[entrypoint] Initializing Beads in $BEADS_DIR"
  cd "$BEADS_DIR" && bd init 2>/dev/null || echo "[entrypoint] Warning: bd init failed — is bd installed?"
fi

cd /app
exec "$@"
