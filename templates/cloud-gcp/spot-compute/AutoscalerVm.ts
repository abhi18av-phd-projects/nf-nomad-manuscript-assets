import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "./Util";

export interface MigPolicy {
    migName: string;
    nodeClass: string;
    min: number;
    max: number;
    /** target-value % for percentage-allocated_memory (scale up above this). */
    target: number;
}

export interface AutoscalerVmArgs {
    project: string;
    region: string;
    zone: string;
    subnetwork: Input<string>;
    serviceAccountEmail: Input<string>;
    autoscalerVersion: string;
    /** Prod Nomad HTTP address (aither), e.g. http://<NOMAD_NODE_TAILNET_IP>:4646 */
    aitherNomadAddr: string;
    /** Nomad ACL token with read + cluster-scaling perms on the prod cluster. */
    nomadToken: Input<string>;
    tailscaleKey: Input<string>;
    tailscaleHostname: string;
    migs: MigPolicy[];
    /**
     * Post-scaling cooldown (applies to scale-IN). Larger = idle nodes survive
     * longer before deallocation, so a spot node booted for a burst isn't torn
     * down right after it goes idle (boot cost ~10m). Bidirectional: also gates
     * how soon after a scale-down a scale-up can occur. Default "20m".
     * NOTE: cooldown protects a node for this window after its LAST scaling
     * action; nomad-autoscaler has no stabilization window for a long-running
     * node that later goes idle.
     */
    cooldown: string;
}

const publicKey = getPublicKey();
const sshKeys   = getSshKeysMetadata();

/** Builds the bash that writes one nomad-autoscaler policy file per MIG. */
function buildPoliciesScript(project: string, region: string, migs: MigPolicy[], cooldown: string): string {
    const policyFiles = migs.map(m => [
        `cat > /etc/nomad-autoscaler/policies/${m.nodeClass}.hcl <<'POLEOF'`,
        `scaling "${m.nodeClass}" {`,
        `  enabled = true`,
        `  min     = ${m.min}`,
        `  max     = ${m.max}`,
        `  policy {`,
        `    # cooldown gates scale-IN: an idle node survives this long after its`,
        `    # last scaling action before being deallocated (boot cost ~10m).`,
        `    cooldown            = "${cooldown}"`,
        `    evaluation_interval = "30s"`,
        `    check "mem_util" {`,
        `      source = "nomad_apm"`,
        `      query  = "percentage-allocated_memory"`,
        `      strategy "target-value" { target = ${m.target} }`,
        `    }`,
        `    target "gce-mig" {`,
        `      project    = "${project}"`,
        `      region     = "${region}"`,
        `      mig_name   = "${m.migName}"`,
        `      node_class = "${m.nodeClass}"`,
        `    }`,
        `  }`,
        `}`,
        `POLEOF`,
    ].join("\n")).join("\n");
    const bash = `mkdir -p /etc/nomad-autoscaler/policies\n${policyFiles}`;
    // base64-encode → single-line injection into cloud-init runcmd (no YAML indent pitfalls).
    const b64 = Buffer.from(bash, "utf-8").toString("base64");
    return `echo "${b64}" | base64 -d | bash`;
}

/** Always-on e2-small VM running nomad-autoscaler against the prod cluster. */
export class AutoscalerVm extends pulumi.ComponentResource {
    public readonly privateIp: pulumi.Output<string>;

    constructor(name: string, args: AutoscalerVmArgs, opts?: pulumi.ComponentResourceOptions) {
        super("nomadcluster:spot-compute::AutoscalerVm", name, {}, opts);

        const policiesScript = buildPoliciesScript(args.project, args.region, args.migs, args.cooldown);

        const cloudInit = pulumi.all([args.tailscaleKey, args.nomadToken]).apply(([tailscaleKey, nomadToken]) =>
            getScript("cloud-init-autoscaler.yml", {
                publicKey,
                autoscalerVersion: args.autoscalerVersion,
                tailscaleKey,
                tailscaleHostname: args.tailscaleHostname,
                aitherNomadAddr:   args.aitherNomadAddr,
                nomadToken,
                policiesScript,
            })
        );

        const vm = new gcp.compute.Instance(name, {
            name:        name,
            project:     args.project,
            zone:        args.zone,
            machineType: "e2-small",
            allowStoppingForUpdate: true,
            bootDisk: {
                initializeParams: {
                    image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
                    size:  20,
                    type:  "pd-balanced",
                },
            },
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                // No public IP — egress via Cloud NAT, reaches aither over Tailscale.
            }],
            metadata: {
                "ssh-keys":       sshKeys,
                "enable-oslogin": "FALSE",
                "user-data":      cloudInit,
            },
            tags: ["nomad-cluster-spot-compute"],
            serviceAccount: {
                // SA with roles/compute.instanceAdmin.v1 — the gce-mig target uses it.
                email:  args.serviceAccountEmail,
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            },
        }, { parent: this });

        this.privateIp = vm.networkInterfaces.apply(i => i[0].networkIp!);
        this.registerOutputs({ privateIp: this.privateIp });
    }
}
