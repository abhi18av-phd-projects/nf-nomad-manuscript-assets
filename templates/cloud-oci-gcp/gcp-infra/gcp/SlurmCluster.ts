import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "../Util";

/**
 * "ubuntu"    — hand-rolled cloud-init on ubuntu-os-cloud/ubuntu-2404-lts-amd64.
 *               Installs Slurm 23.11.4 from apt. Fully works but slurm-web is
 *               blocked by the Slurm version (requires ≥ 24.05).
 *
 * "slurm-gcp" — schedmd-slurm-public/slurm-gcp-6-11-ubuntu-2404-lts-nvidia-570.
 *               Slurm 24.x+ pre-baked; slim cloud-init only adds NFS / munge key /
 *               slurm-web / Nomad / Nextflow. Enables slurm-web 6.x.
 */
type SlurmImageMode = "ubuntu" | "slurm-gcp";

// Pinned image family for the slurm-gcp mode (Ubuntu 24.04, x86_64).
// v6.11 is the final published release from schedmd-slurm-public (repo archived Nov 2025).
const SLURM_GCP_IMAGE =
    "projects/schedmd-slurm-public/global/images/family/slurm-gcp-6-11-ubuntu-2404-lts-nvidia-570";

interface SlurmClusterArgs {
    project: Input<string>;
    zone: Input<string>;
    network: Input<string>;
    subnetwork: Input<string>;
    nomadServerHostname: string;
    tailscaleKey: Input<string>;
    enableOsLogin: Input<boolean>;
    stack: string;
    mungeKeyB64: Input<string>;
    nomadVersion: string;
    slurmDriverArtifactUrl: string;
    /** Whether Nomad ACLs are enabled on the slurm-login client (must match server). */
    aclEnabled?: boolean;
    /**
     * Boot image mode.
     * "ubuntu"    — legacy hand-rolled cloud-init (Slurm 23.11, default)
     * "slurm-gcp" — SchedMD published image with Slurm pre-baked; enables slurm-web
     */
    slurmImageMode?: SlurmImageMode;
    /** Number of worker (compute) nodes. Defaults to 1. */
    workerCount?: number;
}

const publicKey = getPublicKey();
const sshKeys = getSshKeysMetadata();

export class SlurmCluster extends pulumi.ComponentResource {

    public readonly ctrlIp: pulumi.Output<string>;
    public readonly workerIps: pulumi.Output<string[]>;

    constructor(name: string, args: SlurmClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:cluster:gcp::SlurmCluster", name, {}, opts);

        const ctrlInternalIp = "10.0.2.40";
        const ctrlHostname   = `${name}-ctrl`;
        const imageMode: SlurmImageMode = args.slurmImageMode ?? "ubuntu";
        const workerCount = args.workerCount ?? 1;

        // ── Worker IP / hostname table ──────────────────────────────────────
        // Slurm workers occupy 10.0.2.41–49 (ctrl is .40; PBS ctrl is .50+).
        const workers = Array.from({ length: workerCount }, (_, i) => ({
            hostname: `${name}-w${i + 1}`,
            ip:       `10.0.2.${41 + i}`,
        }));

        // ── Boot image selection ────────────────────────────────────────────
        const ctrlImage   = imageMode === "slurm-gcp" ? SLURM_GCP_IMAGE : "ubuntu-os-cloud/ubuntu-2404-lts-amd64";
        const workerImage = imageMode === "slurm-gcp" ? SLURM_GCP_IMAGE : "ubuntu-os-cloud/ubuntu-2404-lts-amd64";

        // ── Cloud-init script selection ─────────────────────────────────────
        const ctrlCloudInitScript   = imageMode === "slurm-gcp"
            ? "cloud-init-slurm-ctrl.slurm-gcp.yml"
            : "cloud-init-slurm-ctrl.yml";
        const workerCloudInitScript = imageMode === "slurm-gcp"
            ? "cloud-init-slurm-worker.slurm-gcp.yml"
            : "cloud-init-slurm-worker.yml";

        // ── Boot disk sizes ─────────────────────────────────────────────────
        const ctrlBootDiskSize   = 50;
        const workerBootDiskSize = imageMode === "slurm-gcp" ? 50 : 30;

        // ── NFS data disk ───────────────────────────────────────────────────
        const nfsDisk = new gcp.compute.Disk(`${name}-nfs`, {
            name: `${name}-nfs`,
            size: 50,
            type: "pd-standard",
            zone: args.zone,
            project: args.project,
        }, { parent: this });

        // ── Pre-formatted template variables for multi-worker cloud-init ────
        // Each NodeName line for slurm.conf (6-space indent for write_files content block).
        const slurmNodeLines = workers.map(w =>
            `      NodeName=${w.hostname} NodeHostname=${w.hostname} NodeAddr=${w.ip} CPUs=8 RealMemory=7800 State=UNKNOWN`
        ).join('\n');
        // Comma-separated list for PartitionName=... Nodes=... lines.
        const slurmPartitionNodes = workers.map(w => w.hostname).join(',');
        // Shell commands to pin worker IPs in /etc/hosts (4-space indent for runcmd block).
        const workerHostsScript = workers.map(w =>
            `grep -q "^${w.ip} ${w.hostname}$" /etc/hosts || echo "${w.ip} ${w.hostname}" >> /etc/hosts`
        ).join('\n    ');

        // ── Controller cloud-init ───────────────────────────────────────────
        const ctrlCloudInit = pulumi.all([args.tailscaleKey, args.mungeKeyB64]).apply(
            ([tailscaleKey, mungeKeyB64]) =>
                getScript(ctrlCloudInitScript, {
                    publicKey:              publicKey,
                    tailscaleKey:           tailscaleKey,
                    tailscaleHostname:      `abc-${args.stack}-slurm-ctrl`,
                    ctrlHostname:           ctrlHostname,
                    slurmNodeLines:         slurmNodeLines,
                    slurmPartitionNodes:    slurmPartitionNodes,
                    workerHostsScript:      workerHostsScript,
                    nomad_server_hostname:  args.nomadServerHostname,
                    nomad_version:          args.nomadVersion,
                    munge_key_b64:          mungeKeyB64,
                    slurmDriverArtifactUrl: args.slurmDriverArtifactUrl,
                    aclEnabled:             (args.aclEnabled ?? true) ? "true" : "false",
                })
        );

        // ── Controller VM ───────────────────────────────────────────────────
        const ctrlVm = new gcp.compute.Instance(`${name}-ctrl`, {
            name:                   `${name}-ctrl`,
            project:                args.project,
            zone:                   args.zone,
            machineType:            "e2-custom-4-8192",   // 4 vCPUs, 8 GB RAM
            allowStoppingForUpdate: true,
            bootDisk: {
                initializeParams: {
                    image: ctrlImage,
                    size:  ctrlBootDiskSize,
                    type:  "pd-balanced",
                },
            },
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                networkIp:  ctrlInternalIp,
            }],
            metadata: {
                "ssh-keys":       sshKeys,
                "enable-oslogin": pulumi.output(args.enableOsLogin).apply((v) => v ? "TRUE" : "FALSE"),
                "user-data":      ctrlCloudInit,
            },
            tags: ["slurm-private"],
            serviceAccount: {
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            },
        }, {
            parent: this,
            ignoreChanges: ["attachedDisks"],
        });

        new gcp.compute.AttachedDisk(`${name}-nfs-attach`, {
            project:  args.project,
            zone:     args.zone,
            instance: ctrlVm.name,
            disk:     nfsDisk.selfLink,
        }, { parent: this, dependsOn: [ctrlVm, nfsDisk] });

        // ── Worker cloud-init (no Tailscale — workers stay on internal GCP network) ─
        const workerCloudInit = (workerName: string) =>
            pulumi.all([args.mungeKeyB64]).apply(([mungeKeyB64]) =>
                getScript(workerCloudInitScript, {
                    publicKey:    publicKey,
                    ctrlIp:       ctrlInternalIp,
                    ctrlHostname: ctrlHostname,
                    munge_key_b64: mungeKeyB64,
                    nodeName:     workerName,
                })
            );

        // ── Worker VMs ──────────────────────────────────────────────────────
        const workerVms = workers.map((w) =>
            new gcp.compute.Instance(`${name}-${w.hostname.split('-').pop()}`, {
                name:                   w.hostname,
                project:                args.project,
                zone:                   args.zone,
                machineType:            "e2-highcpu-8",   // 8 vCPUs, 8 GB RAM
                allowStoppingForUpdate: true,
                bootDisk: {
                    initializeParams: {
                        image: workerImage,
                        size:  workerBootDiskSize,
                        type:  "pd-balanced",
                    },
                },
                networkInterfaces: [{
                    subnetwork: args.subnetwork,
                    networkIp:  w.ip,
                }],
                metadata: {
                    "ssh-keys":       sshKeys,
                    "enable-oslogin": pulumi.output(args.enableOsLogin).apply((v) => v ? "TRUE" : "FALSE"),
                    "user-data":      workerCloudInit(w.hostname),
                },
                tags: ["slurm-private"],
                serviceAccount: {
                    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
                },
            }, { parent: this, dependsOn: [ctrlVm] })
        );

        // ── Firewall rules ──────────────────────────────────────────────────

        // Slurm inter-daemon communication (slurmctld, slurmd, slurmdbd, slurmrestd)
        new gcp.compute.Firewall(`${name}-slurm-fw`, {
            name:    `${name}-slurm-fw`,
            project: args.project,
            network: args.network,
            allows: [
                { protocol: "tcp", ports: ["6817-6820"] },
                { protocol: "udp", ports: ["6817-6820"] },
            ],
            sourceRanges: ["10.0.2.0/24"],
            targetTags:   ["slurm-private"],
        }, { parent: this });

        // NFS between ctrl and workers
        new gcp.compute.Firewall(`${name}-nfs-fw`, {
            name:    `${name}-nfs-fw`,
            project: args.project,
            network: args.network,
            allows: [
                { protocol: "tcp", ports: ["2049", "111"] },
                { protocol: "udp", ports: ["2049", "111"] },
            ],
            sourceRanges: ["10.0.2.0/24"],
            targetTags:   ["slurm-private"],
        }, { parent: this });

        // ── Outputs ─────────────────────────────────────────────────────────
        this.ctrlIp    = ctrlVm.networkInterfaces.apply(ifaces => ifaces[0].networkIp!);
        this.workerIps = pulumi.all(workerVms.map(vm =>
            vm.networkInterfaces.apply(ifaces => ifaces[0].networkIp!)
        ));

        this.registerOutputs({
            ctrlIp:    this.ctrlIp,
            workerIps: this.workerIps,
        });
    }
}
