# One image for every Lab container: Targets, resolver, gateway, Probes, Collector, toolbox.
# Base is ubuntu:24.04 with Node copied from the official node:22 image (spec, "Lab").
FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      iptables iproute2 faketime dnsmasq-base nginx openssl curl netcat-openbsd \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node:22 /usr/local/bin/node /usr/local/bin/node

COPY lab/image/ /lab/
RUN chmod +x /lab/bin/* && /lab/bin/make-certs.sh

# Probe Node processes trust the Lab CA (spec: NODE_EXTRA_CA_CERTS).
ENV NODE_EXTRA_CA_CERTS=/lab/certs/ca.crt
ENV PATH=/lab/bin:$PATH

WORKDIR /app
COPY package.json /app/package.json
COPY src /app/src
COPY lab/config.json /app/lab/config.json
ENTRYPOINT ["/lab/bin/entry.sh"]
