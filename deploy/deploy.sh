#!/usr/bin/env bash
# From a workstation: sync the repo to the VM and run install.sh there.
# Needs BLASTDOOR_VM_IP and an SSH key path in BLASTDOOR_SSH_KEY_FILE.
set -euo pipefail
: "${BLASTDOOR_VM_IP:?}" "${BLASTDOOR_SSH_KEY_FILE:?}"
SSH="ssh -i $BLASTDOOR_SSH_KEY_FILE -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
rsync -az --delete -e "$SSH" \
  --exclude node_modules --exclude .next --exclude .data --exclude .git --exclude 'proof/*/screens' --exclude sandbox/runner/node_modules \
  ./ "root@$BLASTDOOR_VM_IP:/opt/blast-door/"
# Record exactly what is going live, so the footer and /api/health can name the commit.
COMMIT=$(git rev-parse HEAD)
MAIN=$(git rev-parse --verify -q origin/main || true)
ON_MAIN=false; git merge-base --is-ancestor HEAD origin/main 2>/dev/null && ON_MAIN=true
DIRTY=false; [ -n "$(git status --porcelain --untracked-files=no)" ] && DIRTY=true
printf '{"commit":"%s","branch":"%s","main":"%s","onMain":%s,"dirty":%s,"deployedAt":"%s"}\n' \
  "$COMMIT" "$(git rev-parse --abbrev-ref HEAD)" "$MAIN" "$ON_MAIN" "$DIRTY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  | $SSH "root@$BLASTDOOR_VM_IP" 'cat > /opt/blast-door/.revision.json'
$SSH "root@$BLASTDOOR_VM_IP" 'bash /opt/blast-door/deploy/install.sh'
