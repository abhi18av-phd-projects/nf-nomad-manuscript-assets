import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "./Util";

const GCS_ARTIFACTS = "https://storage.googleapis.com/abc-hpc-bridge-artifacts";
const DEFAULT_ARTIFACTS = {
    exec2Url:       `${GCS_ARTIFACTS}/nomad-driver-exec2`,
    containerdUrl:  `${GCS_ARTIFACTS}/nomad-driver-containerd`,
    podmanUrl:      `${GCS_ARTIFACTS}/nomad-driver-podman`,
    singularityUrl: `${GCS_ARTIFACTS}/nomad-driver-singularity`,
};

export interface SpotPoolMigArgs {
    project: Input<string>;
    region: Input<string>;
    subnetwork: Input<string>;
    machineType: string;
    cpus: number;
    memGb: number;
    /** Distinct node_class per MIG so the autoscaler can target it. */
    nodeClass: string;
    /** Initial MIG size (== autoscaler min). Autoscaler owns it thereafter. */
    minSize: number;
    nomadVersion: string;
    prodServerJoin: string;
    datacenter: string;
    nodePool: string;
    localitySite: string;
    nfWorkPath: string;
    scratchPath: string;
    /** Dedicated data disk (GB) for worker scratch, mounted at /data. */
    dataDiskGb: number;
    tailscaleKey: Input<string>;
    driverArtifacts?: { exec2Url?: string; containerdUrl?: string; podmanUrl?: string; singularityUrl?: string; };
}

const publicKey = getPublicKey();
const sshKeys   = getSshKeysMetadata();

/**
 * A regional, SPOT (preemptible) GCP Managed Instance Group whose instances
 * join an existing prod Nomad cluster as compute clients of a single
 * node_class. Size is controlled at runtime by the Nomad Autoscaler
 * (gce-mig target); Pulumi only seeds the initial (== min) size.
 */
export class SpotPoolMig extends pulumi.ComponentResource {
    public readonly migName: string;
    public readonly nodeClass: string;

    constructor(name: string, args: SpotPoolMigArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:spot-compute::SpotPoolMig", name, {}, opts);

        const artifacts = { ...DEFAULT_ARTIFACTS, ...args.driverArtifacts };

        const cloudInit = pulumi.all([args.tailscaleKey]).apply(([tailscaleKey]) =>
            getScript("cloud-init-spot-mig.yml", {
                publicKey,
                nomad_version:          args.nomadVersion,
                arch:                   "amd64",
                prodServerJoin:         args.prodServerJoin,
                datacenter:             args.datacenter,
                nodePool:               args.nodePool,
                nodeClass:              args.nodeClass,
                localitySite:           args.localitySite,
                nodeCpus:               String(args.cpus),
                nodeMemGb:              String(args.memGb),
                nfWorkPath:             args.nfWorkPath,
                scratchPath:            args.scratchPath,
                dataDiskDevice:         "/dev/disk/by-id/google-nfdata",
                tailscaleKey,
                exec2ArtifactUrl:       artifacts.exec2Url,
                containerdArtifactUrl:  artifacts.containerdUrl,
                podmanArtifactUrl:      artifacts.podmanUrl,
                singularityArtifactUrl: artifacts.singularityUrl,
            })
        );

        const tpl = new gcp.compute.InstanceTemplate(`${name}-tpl`, {
            project:     args.project,
            description: `Spot ${args.machineType} compute client (${args.nodeClass}) joining ${args.datacenter}/${args.nodePool}`,
            machineType: args.machineType,
            scheduling: {
                preemptible:       true,
                automaticRestart:  false,
                provisioningModel: "SPOT",
                onHostMaintenance: "TERMINATE",
            },
            disks: [
                {
                    boot:        true,
                    autoDelete:  true,
                    sourceImage: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
                    diskSizeGb:  50,
                    diskType:    "pd-balanced",
                },
                {
                    // Blank data disk for worker scratch (nf-work + scratch).
                    // deviceName fixes the in-VM path to /dev/disk/by-id/google-nfdata
                    // so cloud-init can format + mount it deterministically.
                    boot:        false,
                    autoDelete:  true,
                    diskSizeGb:  args.dataDiskGb,
                    diskType:    "pd-balanced",
                    deviceName:  "nfdata",
                },
            ],
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                // No access config = no public IP; egress via Cloud NAT, mesh via Tailscale.
            }],
            metadata: {
                "ssh-keys":       sshKeys,
                "enable-oslogin": "FALSE",
                "user-data":      cloudInit,
            },
            tags: ["abc-spot-compute"],
            serviceAccount: { scopes: ["https://www.googleapis.com/auth/cloud-platform"] },
        }, { parent: this });

        const migName = `${name}-mig`;
        const mig = new gcp.compute.RegionInstanceGroupManager(migName, {
            name:             migName,
            baseInstanceName: name,
            project:          args.project,
            region:           args.region,
            versions:         [{ instanceTemplate: tpl.selfLink }],
            targetSize:       args.minSize,           // seed = min; autoscaler owns it after
            namedPorts:       [{ name: "nomad-http", port: 4646 }],
            // No explicit updatePolicy — GCP defaults are valid for a regional
            // MIG (the autoscaler owns sizing; instance changes are rare).
        }, { parent: this, dependsOn: [tpl], ignoreChanges: ["targetSize"] });

        this.migName   = migName;
        this.nodeClass = args.nodeClass;
        this.registerOutputs({ migName: this.migName, nodeClass: this.nodeClass });
    }
}
