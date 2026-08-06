# Minimal Nomad agent image. Mirrors the upstream nf-nomad docker/ image so the two
# do not drift; the only difference is that the role (server or client) is chosen at
# run time by the config file that is mounted in.
FROM ubuntu:24.04

ARG NOMAD_VERSION=1.11.2
ARG S5CMD_VERSION=2.3.0

RUN apt-get update && apt-get install -y curl unzip iproute2 jq ca-certificates && \
    curl -fsSL https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_amd64.zip -o nomad.zip && \
    unzip nomad.zip && install -m 0755 nomad /usr/local/bin/nomad && rm nomad.zip && \
    curl -Lf https://github.com/peak/s5cmd/releases/download/v${S5CMD_VERSION}/s5cmd_${S5CMD_VERSION}_Linux-64bit.tar.gz | tar -xz && \
    mkdir -p /opt/nomad/utils && mv s5cmd /opt/nomad/utils/ && \
    apt-get purge -y unzip && rm -rf /var/lib/apt/lists/*

# Nomad validates host_volume paths at agent start and refuses to boot if they are
# missing, so both must exist in the image. Discovered the hard way: without this the
# clients exit(1) with "failed to validate volume scratchdir".
RUN mkdir -p /tmp/nomad/scratchdir /opt/nomad/shared

EXPOSE 4646 4647 4648 4648/udp
ENTRYPOINT ["/usr/local/bin/nomad"]
CMD ["agent", "-config=/etc/nomad/agent.hcl"]
