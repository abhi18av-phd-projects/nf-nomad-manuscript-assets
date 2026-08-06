import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "../Util";

// ── Driver types ─────────────────────────────────────────────────────────────

/**
 * Supported Nomad task drivers.
 *
 * Built-in (shipped with the Nomad binary; no plugin binary needed):
 *   raw_exec, exec, java, docker, qemu
 *
 * External plugins (binary downloaded from GCS / custom URL at boot):
 *   exec2         — hashicorp/nomad-driver-exec2  (unveil-based sandbox)
 *   containerd    — Roblox/nomad-driver-containerd
 *   podman        — hashicorp/nomad-driver-podman
 *   singularity   — custom build (nomad-driver-singularity)
 */
export type NomadDriver =
    | "raw_exec"
    | "exec"
    | "java"
    | "docker"
    | "qemu"
    | "exec2"
    | "containerd"
    | "podman"
    | "singularity";

/** All available drivers — used as the default when `drivers` is omitted. */
export const ALL_NOMAD_DRIVERS: NomadDriver[] = [
    "raw_exec", "exec", "java", "docker", "qemu",
    "exec2", "containerd", "podman", "singularity",
];

// GCS bucket that holds the pre-built external plugin binaries.
const GCS_ARTIFACTS = "https://storage.googleapis.com/abc-hpc-bridge-artifacts";

const DEFAULT_ARTIFACTS = {
    exec2Url:       `${GCS_ARTIFACTS}/nomad-driver-exec2`,
    containerdUrl:  `${GCS_ARTIFACTS}/nomad-driver-containerd`,
    podmanUrl:      `${GCS_ARTIFACTS}/nomad-driver-podman`,
    singularityUrl: `${GCS_ARTIFACTS}/nomad-driver-singularity`,
};

// ── Plugin-block generator ────────────────────────────────────────────────────

/**
 * Generates the Nomad HCL plugin blocks for the enabled drivers.
 *
 * Lines are pre-indented with 6 spaces so they fit directly into the YAML
 * `write_files / content: |` literal block (indentation level 6 in cloud-init).
 *
 * Built-in drivers that need no plugin block: exec, java, qemu.
 * (qemu just needs `qemu-system-x86_64` in PATH; exec/java are always on.)
 */
export function generatePluginBlocks(drivers: NomadDriver[]): string {
    const I  = "      ";   // 6 spaces — matches YAML literal block indent
    const I2 = I + "  ";   // 8 spaces
    const I3 = I + "    "; // 10 spaces
    const I4 = I + "      "; // 12 spaces

    const blocks: string[] = [];

    if (drivers.includes("raw_exec")) {
        blocks.push([
            `${I}plugin "raw_exec" {`,
            `${I2}config {`,
            `${I3}enabled = true`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    if (drivers.includes("docker")) {
        blocks.push([
            `${I}plugin "docker" {`,
            `${I2}config {`,
            // Image pull timeouts — bumped above Nomad's defaults so chonky
            // bioinformatics containers (e.g. MAGMA's magma-container-1 is
            // 2.6 GiB across 13 layers) can pull without restart-looping
            // when network throughput is modest. Source: aither's
            // /etc/nomad.d/server.hcl after 2026-06-03 patch; sibling
            // change in abc-deployments/abc-seedling-prod/cloud-init/nomad/.
            //   image_pull_timeout      — total pull window (default 5m)
            //   pull_activity_timeout   — per-progress idle window (default 2m)
            `${I3}image_pull_timeout    = "15m"`,
            `${I3}pull_activity_timeout = "5m"`,
            `${I3}allow_privileged = true`,
            `${I3}volumes {`,
            `${I4}enabled = true`,
            `${I3}}`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    if (drivers.includes("exec2")) {
        blocks.push([
            `${I}plugin "nomad-driver-exec2" {`,
            `${I2}config {`,
            `${I3}unveil_defaults = true`,
            `${I3}unveil_paths    = []`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    if (drivers.includes("containerd")) {
        blocks.push([
            `${I}plugin "containerd-driver" {`,
            `${I2}config {`,
            `${I3}enabled            = true`,
            `${I3}containerd_runtime = "io.containerd.runc.v2"`,
            `${I3}stats_interval     = "5s"`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    if (drivers.includes("podman")) {
        blocks.push([
            `${I}plugin "nomad-driver-podman" {`,
            `${I2}config {`,
            `${I3}socket_path = "unix:///run/podman/podman.sock"`,
            `${I3}volumes {`,
            `${I4}enabled = true`,
            `${I3}}`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    if (drivers.includes("singularity")) {
        blocks.push([
            `${I}plugin "nomad-driver-singularity" {`,
            `${I2}config {`,
            `${I3}enabled          = true`,
            `${I3}singularity_path = "/usr/bin/singularity"`,
            `${I2}}`,
            `${I}}`,
        ].join("\n"));
    }

    // exec, java: always-on built-ins, no plugin block required.
    // qemu:       built-in; detected automatically when qemu-system-x86_64 is in PATH.

    return blocks.join("\n\n");
}

// ── Interface ────────────────────────────────────────────────────────────────

interface NomadClientArgs {
    project: Input<string>;
    zone: Input<string>;
    subnetwork: Input<string>;
    /** Tailscale MagicDNS hostname of the Nomad server (e.g. abc-dev-nomad-server) */
    serverHostname: string;
    tailscaleKey: Input<string>;
    enableOsLogin: Input<boolean>;
    stack: string;
    index: number;
    /** If set, creates and attaches an extra persistent disk of this size (GB) for host volumes */
    attachedDiskSizeGb?: number;
    /** Whether Nomad ACLs are enabled on this client (must match the server's ACL state). */
    aclEnabled?: boolean;
    /** Nomad node_class for this client. Defaults to "gcp-ondemand". Use "gcp-spot" for preemptible instances. */
    nodeClass?: string;
    /** Make this instance preemptible (spot). Sets scheduling accordingly. */
    preemptible?: boolean;
    /** Override the Tailscale hostname. Defaults to abc-<stack>-nomad-client-<index>. */
    tailscaleHostnameOverride?: string;
    /**
     * Nomad task drivers to install and enable.
     * Defaults to ALL_NOMAD_DRIVERS (all 9 drivers).
     * Tip: pass a subset to skip heavy installs on lightweight spot clients.
     */
    drivers?: NomadDriver[];
    /**
     * URL overrides for external plugin binary downloads.
     * Defaults to the abc-hpc-bridge-artifacts GCS bucket.
     * Each binary must be a standalone executable (not zipped).
     */
    driverArtifacts?: {
        exec2Url?: string;
        containerdUrl?: string;
        podmanUrl?: string;
        singularityUrl?: string;
    };
}

// ── Component ────────────────────────────────────────────────────────────────

const publicKey = getPublicKey();
const sshKeys   = getSshKeysMetadata();

export class NomadClient extends pulumi.ComponentResource {

    public readonly id: pulumi.Output<string>;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: NomadClientArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:cluster:gcp::NomadClient", name, {}, opts);

        const tailscaleHostname = args.tailscaleHostnameOverride
            ?? `abc-${args.stack}-nomad-client-${args.index}`;

        const nodeClass = args.nodeClass ?? "gcp-ondemand";

        // Resolve driver list and artifact URLs.
        const drivers   = args.drivers ?? ALL_NOMAD_DRIVERS;
        const artifacts = { ...DEFAULT_ARTIFACTS, ...args.driverArtifacts };

        // Generate plugin HCL blocks (pre-indented for YAML write_files).
        const nomadPluginBlocks = generatePluginBlocks(drivers);

        const cloudInit = pulumi.all([args.tailscaleKey]).apply(([tailscaleKey]) =>
            getScript("cloud-init-nomad-client.yml", {
                publicKey,
                nomad_version:          "1.11.2",
                nomad_server_hostname:  args.serverHostname,
                arch:                   "amd64",
                tailscaleKey,
                tailscaleHostname,
                aclEnabled:             (args.aclEnabled ?? true) ? "true" : "false",
                nodeClass,
                nomadPluginBlocks,
                exec2ArtifactUrl:       artifacts.exec2Url,
                containerdArtifactUrl:  artifacts.containerdUrl,
                podmanArtifactUrl:      artifacts.podmanUrl,
                singularityArtifactUrl: artifacts.singularityUrl,
            })
        );

        const scheduling: gcp.types.input.compute.InstanceScheduling | undefined =
            args.preemptible
                ? { preemptible: true, automaticRestart: false, onHostMaintenance: "TERMINATE" }
                : undefined;

        const vm = new gcp.compute.Instance(name, {
            name:                   name,
            project:                args.project,
            zone:                   args.zone,
            machineType:            "e2-custom-4-8192", // 4 vCPUs, 8 GB RAM
            allowStoppingForUpdate: true,
            scheduling:             scheduling,
            bootDisk: {
                initializeParams: {
                    image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
                    size:  50,
                    type:  "pd-balanced",
                },
            },
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                // No accessConfig = no public IP; access via Tailscale only.
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

        // Attach an extra persistent disk if requested (e.g. for MinIO host volume).
        if (args.attachedDiskSizeGb !== undefined) {
            const dataDisk = new gcp.compute.Disk(`${name}-data`, {
                name:    `${name}-data`,
                project: args.project,
                zone:    args.zone,
                size:    args.attachedDiskSizeGb,
                type:    "pd-balanced",
            }, { parent: this });

            new gcp.compute.AttachedDisk(`${name}-data-attach`, {
                project:  args.project,
                zone:     args.zone,
                instance: vm.name,
                disk:     dataDisk.selfLink,
            }, { parent: this, dependsOn: [vm, dataDisk] });
        }

        this.ip = vm.networkInterfaces.apply(ifaces => ifaces[0].networkIp!);
        this.id = vm.id;

        this.registerOutputs();
    }
}
