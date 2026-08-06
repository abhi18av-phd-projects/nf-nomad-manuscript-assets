job "traefik" {
  region      = "global"
  type        = "service"

  group "traefik" {
    count = 1

    # Server is coordinator-only in this stack, so run Traefik on client-0.
    constraint {
      attribute = "${node.unique.name}"
      operator  = "regexp"
      value     = ".*-nomad-client-0(\\..*)?$"
    }

    network {
      port "http" {
        static = 8080
      }

      port "api" {
        static = 8081
      }
    }

    service {
      name = "traefik"
      provider = "nomad"

      check {
        name     = "alive"
        type     = "tcp"
        port     = "http"
        interval = "10s"
        timeout  = "2s"
      }
    }

    task "traefik" {
      driver = "docker"

      config {
        image        = "traefik:v2.2"
        network_mode = "host"

        volumes = [
          "local/traefik.toml:/etc/traefik/traefik.toml",
          "local/dynamic.toml:/etc/traefik/dynamic.toml",
        ]
      }

      template {
        data = <<EOF
[entryPoints]
    [entryPoints.http]
    address = ":8080"
    [entryPoints.traefik]
    address = ":8081"

[api]
    dashboard = true
    insecure  = true
[providers.file]
    filename = "/etc/traefik/dynamic.toml"
    watch = true


EOF

        destination = "local/traefik.toml"
      }

      template {
        data = <<EOF
[http.routers]
  [http.routers.webapp]
    rule = "Host(`dev.abc-cluster.cloud`)"
    entryPoints = ["http"]
    service = "webapp"

[http.services]
  [http.services.webapp.loadBalancer]
    [[http.services.webapp.loadBalancer.servers]]
      url = "http://${webEndpoint}"
EOF

        destination = "local/dynamic.toml"
      }

      resources {
        cpu    = 100
        memory = 128
      }
    }
  }
}
