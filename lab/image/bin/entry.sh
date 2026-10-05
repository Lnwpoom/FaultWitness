#!/bin/sh
# Container entrypoint: set the Lab route and resolver, then start the role's process.
set -eu
role="${1:-toolbox}"
[ $# -gt 0 ] && shift

# Inner containers reach the outer subnet only via the gateway (and the sites route back the same way).
if [ -n "${ROUTE_TO:-}" ]; then ip route replace "$ROUTE_TO" via "$ROUTE_VIA"; fi
# The Lab resolver is the system resolver (no Docker embedded DNS).
if [ -n "${RESOLVER:-}" ]; then echo "nameserver $RESOLVER" > /etc/resolv.conf; fi

case "$role" in
  gateway) exec sleep infinity ;;
  resolver) exec dnsmasq --keep-in-foreground --user=root --conf-file=/lab/etc/dnsmasq.conf ;;
  site)
    /lab/bin/use-cert valid --no-reload
    exec nginx -c /lab/etc/nginx-site.conf -g 'daemon off;' ;;
  local-service) exec nginx -c /lab/etc/nginx-local.conf -g 'daemon off;' ;;
  probe) exec /lab/bin/faketime-node --disable-warning=ExperimentalWarning /app/src/probe/main.ts ;;
  collector) exec node --disable-warning=ExperimentalWarning /app/src/collector/main.ts ;;
  toolbox) exec sleep infinity ;;
  *) exec "$role" "$@" ;;
esac
