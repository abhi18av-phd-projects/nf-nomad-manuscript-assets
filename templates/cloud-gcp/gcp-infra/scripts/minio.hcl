job "minio" {
  datacenters = ["dc1"]
  type        = "service"

  group "minio" {
    count = 1

    # Keep MinIO on client-0 so endpoint references remain stable.
    constraint {
      attribute = "${node.unique.name}"
      operator  = "regexp"
      value     = ".*-nomad-client-0(\\..*)?$"
    }

    network {
      port "api" {
        static       = 9000
        host_network = "private"
      }
      port "console" {
        static       = 9001
        host_network = "tailscale"
      }
    }

    task "minio" {
      driver = "docker"

      config {
        image = "minio/minio:RELEASE.2025-09-07T16-13-09Z"
        args  = ["server", "/data", "--console-address", ":9001"]
        ports = ["api", "console"]
      }

      env {
        MINIO_ROOT_USER     = "${minioAccessKey}"
        MINIO_ROOT_PASSWORD = "${minioSecretKey}"
      }

      resources {
        cpu    = 500
        memory = 512
      }

      service {
        name = "minio"
        port = "api"
        provider = "nomad"

        check {
          type     = "http"
          path     = "/minio/health/live"
          interval = "10s"
          timeout  = "3s"
        }
      }
    }

    # Creates the fixed buckets after MinIO starts.
    # Runs once as a poststart task (not a sidecar).
    task "create-buckets" {
      lifecycle {
        hook    = "poststart"
        sidecar = false
      }

      driver = "docker"

      config {
        image   = "minio/mc:latest"
        entrypoint = ["/bin/sh", "-c"]
        args = [
          "READY=0; for i in $(seq 1 120); do if mc alias set local http://${NOMAD_ADDR_api} ${minioAccessKey} ${minioSecretKey}; then READY=1; break; fi; sleep 2; done; if [ $READY -ne 1 ]; then echo MinIO API did not become ready in time >&2; exit 1; fi; mc mb --ignore-existing local/user-input; mc mb --ignore-existing local/user-output; mc mb --ignore-existing local/work",
        ]
      }

      resources {
        cpu    = 100
        memory = 64
      }
    }
  }
}
