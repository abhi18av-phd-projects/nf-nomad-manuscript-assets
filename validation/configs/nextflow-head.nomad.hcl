# nextflow-head.nomad.hcl — launch a Nextflow pipeline as a Nomad "head" job.
#
# nf-nomad submits each Nextflow process as its own Nomad job via the Nomad API;
# this batch job runs the Nextflow driver itself, on the cluster, so the head and
# its task allocations share one Nomad + work dir.
#
# CLI-FREE REPRODUCTION — the reason this ships as a manuscript asset. A reviewer
# needs no vendor CLI: `nomad job run` this on ANY HashiCorp Nomad cluster.
#
#   # from this configs/ directory (the *.config files are embedded at submit time):
#   nomad job run \
#     -var 'pipeline=mtbseq-nf' \
#     -var 'config_file=e1-armB-nomad-posix.config' \
#     -var 'target_node=<node-name>' \
#     -var 'nextflow_args=-profile docker --input <sheet> -w /work/work-armB' \
#     -var 'nextflow_image=nextflow/nextflow:26.04.3' \
#     nextflow-head.nomad.hcl
#
# Secrets are read from a Nomad Variable at `nomad/jobs/nextflow-head` — set them
# on YOUR cluster first (see nextflow-head.vars.example). Nothing secret is baked
# into this file.

variable "pipeline" {
  type = string
}
variable "config_file" {
  type = string
}
variable "nextflow_args" {
  type    = string
  default = ""
}   # -profile, --input, --outdir, -w ...
variable "nextflow_image" {
  type    = string
  default = "nextflow/nextflow:26.04.3"
}
variable "plugin_version" {
  type    = string
  default = "0.5.0-edge3"
}
variable "target_node" {
  type    = string
  default = ""
}   # pin to one node for E1; empty = any
variable "work_volume" {
  type    = string
  default = "nf-work"
}
# The scheduler evaluates ZERO nodes if this pool has none — the job then hangs
# `pending` with no error message. Set it to a pool that actually has nodes.
variable "node_pool" {
  type    = string
  default = "default"
}
variable "run_tag" {
  type    = string
  default = "run"
}

job "nextflow-head" {
  type      = "batch"
  node_pool = var.node_pool
  meta { run_uuid = uuidv4() }   # force a fresh allocation on every submit

  group "head" {
    # E1 pins to a single node so head + tasks share one POSIX filesystem.
    dynamic "constraint" {
      for_each = var.target_node != "" ? [var.target_node] : []
      content {
        attribute = "$${node.unique.name}"
        value     = constraint.value
      }
    }

    volume "work" {
      type   = "host"
      source = var.work_volume
    }

    task "nextflow" {
      driver = "docker"

      volume_mount {
        volume      = "work"
        destination = "/work"
        read_only   = false
      }

      # Secrets from a Nomad Variable on the reviewer's own cluster. Nothing baked in.
      template {
        destination = "secrets/head.env"
        env         = true
        data        = <<EOT
{{- with nomadVar "nomad/jobs/nextflow-head" }}
NOMAD_TOKEN={{ .nomad_token }}
AWS_ACCESS_KEY_ID={{ .s3_access_key }}
AWS_SECRET_ACCESS_KEY={{ .s3_secret_key }}
{{- end }}
EOT
      }

      # Embed the chosen Nextflow config + the shared trace config at submit time.
      template {
        destination = "local/${var.config_file}"
        data        = <<EOT
${file("./${var.config_file}")}
EOT
      }
      template {
        destination = "local/nextflow.trace.config"
        data        = <<EOT
${file("./nextflow.trace.config")}
EOT
      }

      template {
        destination = "local/entrypoint.sh"
        perms       = "755"
        data        = <<EOT
#!/usr/bin/env bash
set -euo pipefail
cd /local
export NXF_ANSI_LOG=false
export NOMAD_ADDR="http://$${attr.unique.network.ip-address}:4646"
export NOMAD_PLUGIN_VERSION="${var.plugin_version}"
export RUN_TAG="${var.run_tag}"
# NOMAD_TOKEN + AWS creds are injected via secrets/head.env (env=true).
exec nextflow run ${var.pipeline} -c /local/${var.config_file} ${var.nextflow_args}
EOT
      }

      config {
        image    = var.nextflow_image
        work_dir = "/local"
        command  = "bash"
        args     = ["/local/entrypoint.sh"]
      }

      resources {
        cpu    = 1000
        memory = 2048
      }
    }
  }
}
