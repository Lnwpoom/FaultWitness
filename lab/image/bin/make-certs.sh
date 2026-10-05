#!/bin/sh
# Lab CA plus HTTPS certificates for both External Sites, and an expired one for Site X (the certX Fault).
set -eu
D=/lab/certs
mkdir -p "$D"
cd "$D"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=FaultWitness Lab CA" 2>/dev/null

leaf() { # leaf <name> <outfile> [faketime-date]
  printf 'subjectAltName=DNS:%s.lab\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' "$1" > "$1.ext"
  [ -f "$1.key" ] || openssl genrsa -out "$1.key" 2048 2>/dev/null
  openssl req -new -key "$1.key" -subj "/CN=$1.lab" -out "$1.csr" 2>/dev/null
  if [ -n "${3:-}" ]; then
    # explicit start date in the past, 30 days long: expired long before today
    faketime "$3" openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
      -days 30 -extfile "$1.ext" -out "$2" 2>/dev/null
  else
    openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
      -days 3650 -extfile "$1.ext" -out "$2" 2>/dev/null
  fi
}
leaf site-x site-x.crt
leaf site-y site-y.crt
leaf site-x site-x-expired.crt '2020-01-01 00:00:00'
rm -f ./*.csr ./*.ext
openssl x509 -in site-x-expired.crt -noout -enddate
