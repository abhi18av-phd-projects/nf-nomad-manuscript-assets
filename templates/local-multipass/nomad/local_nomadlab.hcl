#NOTE: Make sure that the docker desktop has `grpc FUSE` insated of the default
# `VirtioFS` for an implementation without fusion.

plugin "docker" {

    config {
        allow_privileged = true
    }

    volumes {
        enabled = true
    }
}


client {

    options {
        "docker.priviledged.enabled" = "true"
    }

    host_volume "launch_dir" {
        path      = "/Users/abhi/projects/PHD-pub-nf-nomad/analysis/infrastructure/03_automation/030_misc_local_nomadlab/"

        read_only = false
    }



    host_volume "work" {
        path      = "/Users/abhi/projects/PHD-pub-nf-nomad/analysis/infrastructure/03_automation/030_misc_local_nomadlab/work"

        read_only = false
    }



    host_volume "dothome_nextflow" {
        path      = "/Users/abhi/.nextflow"

        read_only = false
    }

}
