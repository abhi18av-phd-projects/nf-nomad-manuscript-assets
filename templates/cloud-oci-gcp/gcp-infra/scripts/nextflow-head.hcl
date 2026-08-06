job "nextflow-head" {
  datacenters = ["dc1"]
  type        = "batch"

  # Force new allocation on each submission
  meta {
    run_uuid = "${run_uuid}"
  }

  group "head" {
    volume "nextflow-work" {
      type   = "host"
      source = "nextflow-work"
    }

    task "nextflow" {
      driver = "docker"

      resources {
        cpu    = 1000
        memory = 2048
      }

      volume_mount {
        volume      = "nextflow-work"
        destination = "/work/nextflow-work"
        read_only   = false
      }

      # Render the Nextflow config into the allocation
      template {
        destination = "local/nextflow.headjob.config"
        data = <<EOT
${nextflow_config}
EOT
      }

      # Render AWS credentials from Nomad Variables into secrets file
      template {
        destination = "secrets/aws.env"
        env         = true
        data = <<EOT
{{ with nomadVar "nomad/jobs/nextflow-head/head/nextflow" -}}
AWS_ACCESS_KEY_ID={{ .AWS_ACCESS_KEY_ID }}
AWS_SECRET_ACCESS_KEY={{ .AWS_SECRET_ACCESS_KEY }}
{{ end -}}
EOT
      }

      # Entrypoint script
      template {
        destination = "local/entrypoint.sh"
        perms       = "755"
        data = <<EOT
#!/usr/bin/env bash
set -euo pipefail
cd /local

export NXF_ANSI_LOG=false
export NXF_HOME=/work/nextflow-work/.nxf-home

nextflow run ${pipeline} \
  -c /local/nextflow.headjob.config \
  ${pipeline_args}
EOT
      }


      config {
        image    = "nextflow/nextflow:25.10.4"
        work_dir = "/local"
        command  = "bash"
        args     = ["/local/entrypoint.sh"]
      }

      env {
        NOMAD_ADDR  = "${nomad_addr}"
        NOMAD_TOKEN = "${nomad_token}"
        NF_MINIO_ENDPOINT = "${nf_minio_endpoint}"
      }
    }
  }
}
