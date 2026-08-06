import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "../Util";

/**
 * "ubuntu"  — standard Ubuntu 24.04 image; OpenPBS 23.06 built from source in cloud-init.
 *             First boot takes ~20–25 min. Good for development and initial testing.
 *
 * "pbs-gcp" — custom GCP image with OpenPBS pre-compiled (produced by packer/pbs-gcp.pkr.hcl).
 *             Cloud-init only does per-node configuration. First boot ~8 min.
 *             Run `packer build gcp-infra/packer/pbs-gcp.pkr.hcl` once to produce the image.
 */
type PbsImageMode = "ubuntu" | "pbs-gcp";

// Custom GCP image family baked by packer/pbs-gcp.pkr.hcl.
const PBS_GCP_IMAGE = "projects/<YOUR_GCP_PROJECT_ID>/global/images/family/pbs-gcp-23-06-ubuntu-2404-lts";

// PBS daemon ports used for internal cluster communication.
const PBS_PORTS = ["15001", "15002", "15003", "17001"];

interface PbsClusterArgs {
    project: Input<string>;
    zone: Input<string>;
    network: Input<string>;
    subnetwork: Input<string>;
    /** Tailscale MagicDNS hostname of the GCP Nomad server (e.g. abc-dev-nomad-server). */
    nomadServerHostname: string;
    tailscaleKey: Input<string>;
    enableOsLogin: Input<boolean>;
    stack: string;
    nomadVersion: string;
    /** Boot image mode: "ubuntu" (build from source) or "pbs-gcp" (pre-baked image). */
    pbsImageMode?: PbsImageMode;
    /**
     * URL to the pbs driver binary artifact (GCS or HTTPS).
     * The binary must be named "pbs" — Nomad matches plugin blocks by filename.
     * Default: https://storage.googleapis.com/abc-hpc-bridge-artifacts/pbs
     */
    pbsDriverArtifactUrl?: string;
    /** Whether Nomad ACLs are enabled (must match the server). */
    aclEnabled?: boolean;
    /** Number of worker (execution) nodes. Defaults to 1. */
    workerCount?: number;
}

const publicKey = getPublicKey();
const sshKeys = getSshKeysMetadata();

export class PbsCluster extends pulumi.ComponentResource {

    public readonly ctrlIp: pulumi.Output<string>;
    public readonly workerIps: pulumi.Output<string[]>;

    constructor(name: string, args: PbsClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:cluster:gcp::PbsCluster", name, {}, opts);

        // PBS cluster occupies 10.0.2.50 (ctrl) and 10.0.2.51+ (workers).
        // This avoids conflicts with Slurm (.40 ctrl, .41–.49 workers).
        const ctrlInternalIp = "10.0.2.50";
        const ctrlHostname   = `${name}-ctrl`;
        const imageMode: PbsImageMode = args.pbsImageMode ?? "ubuntu";
        const workerCount = args.workerCount ?? 1;

        // ── Worker IP / hostname table ──────────────────────────────────────
        const workers = Array.from({ length: workerCount }, (_, i) => ({
            hostname: `${name}-w${i + 1}`,
            ip:       `10.0.2.${51 + i}`,
        }));

        // ── Boot image selection ────────────────────────────────────────────
        const ubuntuImage = "ubuntu-os-cloud/ubuntu-2404-lts-amd64";
        const ctrlImage   = imageMode === "pbs-gcp" ? PBS_GCP_IMAGE : ubuntuImage;
        const workerImage = imageMode === "pbs-gcp" ? PBS_GCP_IMAGE : ubuntuImage;

        // ── Cloud-init script selection ─────────────────────────────────────
        const ctrlCloudInitScript   = imageMode === "pbs-gcp"
            ? "cloud-init-pbs-ctrl.pbs-gcp.yml"
            : "cloud-init-pbs-ctrl.ubuntu.yml";
        const workerCloudInitScript = imageMode === "pbs-gcp"
            ? "cloud-init-pbs-worker.pbs-gcp.yml"
            : "cloud-init-pbs-worker.ubuntu.yml";

        // Larger boot disk for pbs-gcp pre-baked image (OpenPBS compiled in).
        const ctrlBootDiskSize   = 50;
        const workerBootDiskSize = imageMode === "pbs-gcp" ? 50 : 30;

        // ── NFS data disk ───────────────────────────────────────────────────
        const nfsDisk = new gcp.compute.Disk(`${name}-nfs`, {
            name: `${name}-nfs`,
            size: 50,
            type: "pd-standard",
            zone: args.zone,
            project: args.project,
        }, { parent: this });

        // ── Pre-formatted template variables for multi-worker cloud-init ────
        // Shell commands to pin worker IPs in /etc/hosts (4-space indent for runcmd block).
        const workerHostsScript = workers.map(w =>
            `grep -q "^${w.ip} ${w.hostname}$" /etc/hosts || echo "${w.ip} ${w.hostname}" >> /etc/hosts`
        ).join('\n    ');
        // qmgr create node commands for each worker (4-space indent for runcmd block).
        const qmgrNodeLines = workers.map(w =>
            `qmgr -c "create node ${w.hostname}"\n    qmgr -c "set node ${w.hostname} queue=compute"`
        ).join('\n    ');

        // ── Controller cloud-init ───────────────────────────────────────────
        const pbsDriverArtifactUrl = args.pbsDriverArtifactUrl
            ?? "https://storage.googleapis.com/abc-hpc-bridge-artifacts/pbs";

        const ctrlCloudInit = pulumi.all([args.tailscaleKey]).apply(
            ([tailscaleKey]) =>
                getScript(ctrlCloudInitScript, {
                    publicKey:             publicKey,
                    tailscaleKey:          tailscaleKey,
                    tailscaleHostname:     `abc-${args.stack}-pbs-ctrl`,
                    ctrlHostname:          ctrlHostname,
                    ctrlIp:                ctrlInternalIp,
                    workerHostsScript:     workerHostsScript,
                    qmgrNodeLines:         qmgrNodeLines,
                    nomad_server_hostname: args.nomadServerHostname,
                    nomad_version:         args.nomadVersion,
                    pbsDriverArtifactUrl:  pbsDriverArtifactUrl,
                    aclEnabled:            (args.aclEnabled ?? true) ? "true" : "false",
                })
        );

        // ── Controller VM ───────────────────────────────────────────────────
        const ctrlVm = new gcp.compute.Instance(`${name}-ctrl`, {
            name:                   `${name}-ctrl`,
            project:                args.project,
            zone:                   args.zone,
            machineType:            "e2-standard-2",   // 2 vCPUs, 8 GB RAM
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
            tags: ["pbs-private"],
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
            pulumi.all([args.tailscaleKey]).apply(([_tailscaleKey]) =>
                getScript(workerCloudInitScript, {
                    publicKey:    publicKey,
                    ctrlIp:       ctrlInternalIp,
                    ctrlHostname: ctrlHostname,
                    nodeName:     workerName,
                })
            );

        // ── Worker VMs ──────────────────────────────────────────────────────
        const workerVms = workers.map((w) =>
            new gcp.compute.Instance(`${name}-${w.hostname.split('-').pop()}`, {
                name:                   w.hostname,
                project:                args.project,
                zone:                   args.zone,
                machineType:            "e2-standard-2",   // 2 vCPUs, 8 GB RAM
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
                tags: ["pbs-private"],
                serviceAccount: {
                    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
                },
            }, { parent: this, dependsOn: [ctrlVm] })
        );

        // ── Firewall rules ──────────────────────────────────────────────────

        // OpenPBS inter-daemon communication (pbs_server, pbs_mom, pbs_sched, pbs_comm)
        new gcp.compute.Firewall(`${name}-pbs-fw`, {
            name:        `${name}-pbs-fw`,
            project:     args.project,
            network:     args.network,
            allows: [
                { protocol: "tcp", ports: PBS_PORTS },
                { protocol: "udp", ports: PBS_PORTS },
            ],
            sourceRanges: ["10.0.2.0/24"],
            targetTags:   ["pbs-private"],
        }, { parent: this });

        // NFS between PBS ctrl and workers
        new gcp.compute.Firewall(`${name}-nfs-fw`, {
            name:    `${name}-nfs-fw`,
            project: args.project,
            network: args.network,
            allows: [
                { protocol: "tcp", ports: ["2049", "111"] },
                { protocol: "udp", ports: ["2049", "111"] },
            ],
            sourceRanges: ["10.0.2.0/24"],
            targetTags:   ["pbs-private"],
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
