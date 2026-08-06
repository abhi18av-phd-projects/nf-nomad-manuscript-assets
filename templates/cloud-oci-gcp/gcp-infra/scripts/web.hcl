job "webapp" {
  datacenters = ["dc1"]
  type        = "service"

  group "landing" {
    # Keep landing page on client-0 so Traefik can target a stable upstream host.
    constraint {
      attribute = "${node.unique.name}"
      operator  = "regexp"
      value     = ".*-nomad-client-0(\\..*)?$"
    }

    network {
      port "http" {
        static = 8082
        to = 80
      }
    }

    service {
      name     = "web-svc"
      port     = "http"

      provider = "nomad"

      tags = [
        "traefik.enable=true",
        "traefik.http.routers.webapp.rule=Host(`dev.abc-cluster.cloud`)",
        "traefik.http.routers.webapp.entrypoints=http",
      ]

      check {
        type     = "tcp"
        interval = "10s"
        timeout  = "2s"
      }
    }

    task "server" {
      driver = "docker"

      config {
        image = "docker.io/library/nginx:1.27-alpine"
        ports = ["http"]
        volumes = [
          "local/index.html:/usr/share/nginx/html/index.html",
        ]
      }

      template {
        destination = "local/index.html"
        data        = <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ABC Cluster</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    main {
      text-align: center;
      padding: 2rem;
      max-width: 560px;
    }

    .badge {
      display: inline-block;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 999px;
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.3rem 0.9rem;
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #f8fafc;
      margin-bottom: 0.75rem;
    }

    p {
      font-size: 1rem;
      line-height: 1.7;
      color: #94a3b8;
      margin-bottom: 1.4rem;
    }

    .notes {
      display: grid;
      gap: 0.6rem;
      margin-bottom: 2rem;
      text-align: left;
    }

    .note {
      background: #162133;
      border: 1px solid #2f405e;
      border-radius: 0.5rem;
      padding: 0.7rem 0.9rem;
      font-size: 0.88rem;
      color: #cbd5e1;
      font-family: "SFMono-Regular", Consolas, monospace;
    }

    .endpoints {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .endpoint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 0.85rem 1.25rem;
      text-decoration: none;
      color: #e2e8f0;
      transition: border-color 0.15s, background 0.15s;
    }

    .endpoint:hover {
      background: #263348;
      border-color: #4f6a8f;
    }

    .endpoint-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
    }

    .endpoint-url {
      font-size: 0.9rem;
      font-family: "SFMono-Regular", Consolas, monospace;
      color: #7dd3fc;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
      flex-shrink: 0;
    }

    footer {
      margin-top: 3rem;
      font-size: 0.75rem;
      color: #334155;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">Operational</div>
    <h1>ABC Cluster</h1>
    <p>A private Nextflow execution cluster.</p>

    <div class="notes">
      <div class="note">Nomad Console: private network </div>
      <div class="note">MinIO Console and API: private network </div>
      <div class="note">ABC-cli: latest release and downloads at <a href="https://github.com/abc-cluster/abc-cluster-cli/releases/latest" style="color: #67e8f9; text-decoration: underline;">github.com/abc-cluster/abc-cluster-cli/releases/latest</a></div>
    </div>

    <div class="endpoints">
      <a class="endpoint" href="http://dev.abc-cluster.cloud/v1/" target="_blank">
        <div>
          <div class="endpoint-label">Nomad API (with token)</div>
          <div class="endpoint-url">dev.abc-cluster.cloud/v1</div>
        </div>
        <div class="dot"></div>
      </a>
      <a class="endpoint" href="http://dev.abc-cluster.cloud/files/" target="_blank">
        <div>
          <div class="endpoint-label">tusd Uploads (with token)</div>
          <div class="endpoint-url">dev.abc-cluster.cloud/files</div>
        </div>
        <div class="dot"></div>
      </a>
    </div>

    <footer>Public URL serves landing page, /v1, and /files only.</footer>
  </main>
</body>
</html>
EOF
      }

      resources {
        cpu    = 200
        memory = 512
      }
    }
  }
}
