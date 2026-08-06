# Client only. Replicated N times by docker compose --scale; each container gets a
# distinct node name from the Nomad agent's default (its hostname).
data_dir  = "/tmp/nomad/"
bind_addr = "0.0.0.0"

server { enabled = false }

client {
  enabled   = true
  servers   = ["nomad-server:4647"]
  node_pool = "dev"

  # Node-local scratch — private to each client.
  host_volume "scratchdir" {
    path      = "/tmp/nomad/scratchdir"
    read_only = false
  }

  # Shared across all clients via a Docker named volume. Stands in for NFS so the
  # shared-POSIX work-dir mode can be exercised locally. It is a same-host
  # emulation, not a network filesystem: it shows the mode works, not how it
  # behaves under network latency.
  host_volume "shared" {
    path      = "/opt/nomad/shared"
    read_only = false
  }
}

acl { enabled = true }

plugin "docker" {
  config {
    allow_privileged = false        # matches the manuscript's §2.1 non-privileged claim
    volumes { enabled = true }
    gc { image = false, image_delay = "1h" }
  }
}

plugin "exec" { enabled = true }
