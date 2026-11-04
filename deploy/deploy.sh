#!/usr/bin/env bash
# From a workstation: sync the repo to the VM and run install.sh there.
# Needs BLASTDOOR_VM_IP and an SSH key path in BLASTDOOR_SSH_KEY_FILE.
set -euo pipefail
: "${BLASTDOOR_VM_IP:?}" "${BLASTDOOR_SSH_KEY_FILE:?}"
SSH="ssh -i $BLASTDOOR_SSH_KEY_FILE -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
rsync -az --delete -e "$SSH" \
  --exclude node_modules --exclude .next --exclude .data --exclude .git --exclude 'proof/*/screens' --exclude sandbox/runner/node_modules \
  ./ "root@$BLASTDOOR_VM_IP:/opt/blast-door/"
$SSH "root@$BLASTDOOR_VM_IP" 'bash /opt/blast-door/deploy/install.sh'
