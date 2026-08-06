#!/usr/local/bin/bash



#NOTE: Make sure to start Docker Desktop before this command
sudo nomad agent -dev -config local_nomadlab.hcl #-bind=0.0.0.0 -network-interface=en0

#-------------------------------
# Run with local_nomadlab
#-------------------------------

nextflow run nextflow-io/hello -c nextflow.local.config

nextflow run nextflow-io/rnaseq-nf -profile docker -c nextflow.local.config

nextflow run pditommaso/nf-sleep -c nextflow.local.config


#-------------------------------
# Run with (remote) sun_nomadlab
#-------------------------------

nextflow run nextflow-io/hello -c nextflow.sun.config

nextflow run nextflow-io/rnaseq-nf -profile docker -c nextflow.sun.config

nextflow run pditommaso/nf-sleep -c nextflow.sun.config
