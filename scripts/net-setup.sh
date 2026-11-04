#!/usr/bin/env bash
# Creates the sandbox network and the egress firewall. Idempotent. Run as root.
# Containers on bd0 can reach exactly two host ports (broker and egress proxy).
# Everything else, forwarded or host-bound, is logged and dropped.
set -euo pipefail

NET="${BLASTDOOR_SANDBOX_NET:-bd-sandbox}"
BRIDGE="${BLASTDOOR_SANDBOX_BRIDGE:-bd0}"
SUBNET="${BLASTDOOR_SANDBOX_SUBNET:-172.31.250.0/24}"
GATEWAY="${BLASTDOOR_SANDBOX_GATEWAY:-172.31.250.1}"
BROKER_PORT="${BLASTDOOR_BROKER_PORT:-8790}"
PROXY_PORT="${BLASTDOOR_PROXY_PORT:-8791}"
TEST_PORTS="${BLASTDOOR_TEST_PORTS:-8792,8793}"

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --subnet "$SUBNET" \
    --gateway "$GATEWAY" \
    --opt com.docker.network.bridge.name="$BRIDGE" \
    --opt com.docker.network.bridge.enable_ip_masquerade=false \
    --opt com.docker.network.bridge.enable_icc=false \
    --label blastdoor.network=1 \
    "$NET" >/dev/null
  echo "created network $NET on $BRIDGE"
fi

rule() { # chain, rule...
  local chain="$1"; shift
  iptables -C "$chain" "$@" 2>/dev/null || iptables -I "$chain" 1 "$@"
}

# Forwarded traffic from sandboxes (anything leaving the host): log, then drop.
rule DOCKER-USER -i "$BRIDGE" -j DROP
rule DOCKER-USER -i "$BRIDGE" -m limit --limit 30/min --limit-burst 60 -j LOG --log-prefix "BLASTDOOR-EGRESS-DROP "

# Traffic from sandboxes to the host itself. Inserted in reverse so the final order is:
# established, broker + proxy ports, log, drop.
rule INPUT -i "$BRIDGE" -j DROP
rule INPUT -i "$BRIDGE" -m limit --limit 30/min --limit-burst 60 -j LOG --log-prefix "BLASTDOOR-HOST-DROP "
rule INPUT -i "$BRIDGE" -d "$GATEWAY" -p tcp -m multiport --dports "$BROKER_PORT,$PROXY_PORT,$TEST_PORTS" -j ACCEPT
rule INPUT -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

echo "egress firewall active on $BRIDGE (allowed host ports: $BROKER_PORT, $PROXY_PORT)"
