job "nextflow" {
  datacenters = ["dc1"]
  type        = "batch"
  group "nextflow" {
    task "nextflow" {
      driver = "docker"
      config {
        image = "nextflow/nextflow:25.10.4"
        command = "nextflow"
        args = ["info"]
      }
    }
  }
}