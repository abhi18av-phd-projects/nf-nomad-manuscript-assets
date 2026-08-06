import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "../Util";
import { NomadDriver, ALL_NOMAD_DRIVERS, generatePluginBlocks } from "./NomadClient";

// ── Interface ────────────────────────────────────────────────────────────────

interface NomadSpotPoolArgs {
    project: Input<string>;
    region: Input<string>;
    subnetwork: Input<string>;
    network: Input<string>;
    /** Tailscale MagicDNS hostname of the Nomad server. */
    serverHostname: string;
    tailscaleKey: Input<string>;
    /** Nomad ACL token for the spot-pool node (abc-gcp-node-policy). Used by nomad-drain service. */
    spotPoolNodeToken?: Input<string>;
    enableOsLogin: Input<boolean>;
    stack: string;
    /** Minimum MIG size. Defaults to 0 (scale-to-zero). */
    minSize?: number;
    /** Maximum MIG size. Defaults to 3. */
    maxSize?: number;
    /** GCP machine type. Defaults to e2-custom-4-8192 (4 vCPU, 8 GB). */
    machineType?: string;
    /** Nomad drivers to enable on pool instances. Defaults to all drivers. */
    drivers?: NomadDriver[];
    /** URL overrides for external plugin binaries. */
    driverArtifacts?: {
        exec2Url?: string;
        containerdUrl?: string;
        podmanUrl?: string;
        singularityUrl?: string;
    };
}

// GCS bucket for plugin binaries — shared with NomadClient defaults.
const GCS_ARTIFACTS = "https://storage.googleapis.com/abc-hpc-bridge-artifacts";
const DEFAULT_ARTIFACTS = {
    exec2Url:       `${GCS_ARTIFACTS}/nomad-driver-exec2`,
    containerdUrl:  `${GCS_ARTIFACTS}/nomad-driver-containerd`,
    podmanUrl:      `${GCS_ARTIFACTS}/nomad-driver-podman`,
    singularityUrl: `${GCS_ARTIFACTS}/nomad-driver-singularity`,
};

// ── Component ────────────────────────────────────────────────────────────────

const publicKey = getPublicKey();
const sshKeys   = getSshKeysMetadata();

export class NomadSpotPool extends pulumi.ComponentResource {

    /** Name of the GCP Managed Instance Group (for autoscaler target config). */
    public readonly migName: string;
    /** GCP self-link of the MIG. */
    public readonly migSelfLink: pulumi.Output<string>;

    constructor(name: string, args: NomadSpotPoolArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:cluster:gcp::NomadSpotPool", name, {}, opts);

        const drivers   = args.drivers ?? ALL_NOMAD_DRIVERS;
        const artifacts = { ...DEFAULT_ARTIFACTS, ...args.driverArtifacts };
        const nomadPluginBlocks = generatePluginBlocks(drivers);

        // Instance name base — GCP appends a random suffix, e.g. abc-dev-spot-a1b2c3.
        // cloud-init reads the actual name from the metadata server for Tailscale hostname.
        const baseInstanceName = `${name}`;

        // ── Cloud-init ───────────────────────────────────────────────────────
        const cloudInit = pulumi.all([args.tailscaleKey, args.spotPoolNodeToken ?? ""]).apply(([tailscaleKey, spotPoolNodeToken]) =>
            getScript("cloud-init-nomad-spot-pool.yml", {
                publicKey,
                nomad_version:          "1.11.2",
                nomad_server_hostname:  args.serverHostname,
                arch:                   "amd64",
                tailscaleKey,
                spotPoolNodeToken,
                nodeClass:              "gcp-spot",
                nomadPluginBlocks,
                exec2ArtifactUrl:       artifacts.exec2Url,
                containerdArtifactUrl:  artifacts.containerdUrl,
                podmanArtifactUrl:      artifacts.podmanUrl,
                singularityArtifactUrl: artifacts.singularityUrl,
            })
        );

        // ── Instance Template ────────────────────────────────────────────────
        const instanceTemplate = new gcp.compute.InstanceTemplate(`${name}-tpl`, {
            // No explicit name — Pulumi generates a unique physical name so replacements
            // (create-new → update-MIG → delete-old) work without name conflicts.
            project:     args.project,
            description: `Nomad spot-pool instance template for stack ${args.stack}`,
            machineType: args.machineType ?? "e2-custom-4-8192",
            scheduling: {
                preemptible:         true,
                automaticRestart:    false,
                onHostMaintenance:   "TERMINATE",
                provisioningModel:   "SPOT",
            },
            disks: [{
                boot:        true,
                autoDelete:  true,
                sourceImage: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
                diskSizeGb:  50,
                diskType:    "pd-balanced",
            }],
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                // No access config = no public IP; access via Tailscale only.
            }],
            metadata: {
                "ssh-keys":       sshKeys,
                "enable-oslogin": pulumi.output(args.enableOsLogin).apply(v => v ? "TRUE" : "FALSE"),
                "user-data":      cloudInit,
            },
            tags: ["nomad-private"],
            serviceAccount: {
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            },
        }, { parent: this });

        // ── Managed Instance Group (regional, spot) ──────────────────────────
        // Regional MIG is required by the nomad-autoscaler gce-mig plugin
        // (it uses the regionInstanceGroupManagers API, not zonal).
        // targetSize is set to 0 initially; the Nomad Autoscaler controls the
        // actual size at runtime. ignoreChanges prevents pulumi up from
        // overriding the autoscaler's value on subsequent runs.
        const migName = `${name}-mig`;
        const mig = new gcp.compute.RegionInstanceGroupManager(migName, {
            name:             migName,
            baseInstanceName: baseInstanceName,
            project:          args.project,
            region:           args.region,
            versions: [{
                instanceTemplate: instanceTemplate.selfLink,
            }],
            targetSize: 0,
            namedPorts: [{
                name: "nomad-http",
                port: 4646,
            }],
        }, {
            parent:         this,
            dependsOn:      [instanceTemplate],
            ignoreChanges:  ["targetSize"],   // autoscaler owns this field
        });

        this.migName      = migName;
        this.migSelfLink  = mig.selfLink;

        this.registerOutputs({
            migName:     this.migName,
            migSelfLink: this.migSelfLink,
        });
    }
}
