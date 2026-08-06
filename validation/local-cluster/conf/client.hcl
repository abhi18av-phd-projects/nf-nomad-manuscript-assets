# Client only. Replicated N times by docker compose --scale; each container gets a
# distinct node name from the Nomad agent's default (its hostname).
data_dir  = "/tmp/nomad/"
bind_addr = "0.0.0.0"

server { enabled = false }

client {
  enabled   = true
  servers   = ["nomad-server:4647"]
  node_pool = "dev"

  host_volume "scratchdir" {
    path      = "/tmp/nomad/scratchdir"
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
