# Server only. Holds state and schedules; runs no tasks, so stopping a client
# during a chaos trial exercises rescheduling rather than killing the cluster.
name      = "nomad-server"
data_dir  = "/tmp/nomad/"
bind_addr = "0.0.0.0"

server {
  enabled          = true
  bootstrap_expect = 1
}

client { enabled = false }

acl { enabled = true }
