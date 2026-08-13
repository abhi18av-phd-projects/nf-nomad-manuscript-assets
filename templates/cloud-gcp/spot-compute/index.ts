import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as tailscale from "@pulumi/tailscale";
import { SpotPoolMig } from "./SpotPoolMig";
import { AutoscalerVm, MigPolicy } from "./AutoscalerVm";

// ── Config ────────────────────────────────────────────────────────────────
const cfg    = new pulumi.Config();            // spot-compute:*
const gcpCfg = new pulumi.Config("gcp");
const stack  = pulumi.getStack();

const project = gcpCfg.require("project");
const region  = gcpCfg.require("region");
const zone    = cfg.get("zone") ?? `${region}-a`;

// MIG clients join the prod server's RPC; the autoscaler talks to its HTTP API.
const prodServerJoin  = cfg.get("prodServerJoin")  ?? "<NOMAD_NODE_TAILNET_IP>:4647";        // aither RPC
const aitherNomadAddr = cfg.get("aitherNomadAddr") ?? "http://<NOMAD_NODE_TAILNET_IP>:4646"; // aither HTTP
const datacenter      = cfg.get("datacenter")      ?? "prod";
const nodePool        = cfg.get("nodePool")        ?? "compute";
const localitySite    = cfg.get("localitySite")    ?? "gcp-johannesburg";
const nfWorkPath      = cfg.get("nfWorkPath")      ?? "/opt/nomad-cluster/nf-work";
const scratchPath     = cfg.get("scratchPath")     ?? "/opt/nomad/scratch";
const nomadVersion    = cfg.get("nomadVersion")    ?? "1.11.2";
const autoscalerVer   = cfg.get("autoscalerVersion") ?? "0.4.6";
// Dedicated data disk for worker scratch (nf-work + scratch host_volumes). The
// 50GB boot disk is too small for concurrent bioinformatics scratch (BAMs,
// sorted intermediates); ephemeral_disk can't guard this (it's host disk, not
// alloc disk). Mounted at /data on the node, with nf-work/scratch bind-mounted
// onto it. See the project notes/2026-06-05-nextflow-
// ephemeral-disk-analysis.md.
const dataDiskGb      = cfg.getNumber("dataDiskGb") ?? 300;
// Autoscaler scale-IN cooldown: how long an idle node survives after its last
// scaling action before deallocation. Bumped from 12m → 20m (spot boot cost is
// ~10m; don't tear a node down right after a burst). Tune via
// `pulumi config set spot-compute:scaleInCooldown 30m`.
const scaleInCooldown = cfg.get("scaleInCooldown") ?? "20m";

// Heterogeneous autoscaled spot fleet. Each group → its own MIG + node_class +
// autoscaler policy. min=1 on the smallest keeps a warm node so the autoscaler
// always has a utilization signal; the bigger pools are min=0.
interface NodeGroup {
    machineType: string; cpus: number; memGb: number;
    nodeClass: string; min: number; max: number; target: number;
}
const DEFAULT_GROUPS: NodeGroup[] = [
    { machineType: "e2-custom-8-16384",  cpus: 8,  memGb: 16, nodeClass: "gcp-spot-8c16g",  min: 1, max: 2, target: 70 },
    { machineType: "e2-custom-16-32768", cpus: 16, memGb: 32, nodeClass: "gcp-spot-16c32g", min: 0, max: 2, target: 70 },
    { machineType: "e2-custom-32-65536", cpus: 32, memGb: 64, nodeClass: "gcp-spot-32c64g", min: 0, max: 1, target: 70 },
];
const nodeGroups = cfg.getObject<NodeGroup[]>("nodeGroups") ?? DEFAULT_GROUPS;

const nomadToken   = cfg.requireSecret("nomadToken");   // aither token for the autoscaler

// ── Tailscale auth keys ─────────────────────────────────────────────────────
// Autoscaler VM is always-on → a persistent (reusable, preauthorized) key.
const tailscaleKey = cfg.requireSecret("tailscaleKey");

// Spot MIG nodes are churny and reclaimed without notice → an EPHEMERAL,
// pre-authorized key so a reclaimed node is auto-removed from the tailnet
// ("untracked") instead of lingering as a stale offline device, and joins
// without manual device approval. Minted in-stack via @pulumi/tailscale when a
// Tailscale API/OAuth credential is present in the environment
// (TAILSCALE_API_KEY or TAILSCALE_OAUTH_CLIENT_ID/SECRET + TAILSCALE_TAILNET —
// same auth path the gcp-infra stack uses). Falls back to a manually-supplied
// key when no API cred is set — in that case the operator MUST create that key
// as ephemeral + reusable + pre-authorized (tag:nomad).
const haveTsApi = !!(process.env.TAILSCALE_API_KEY || process.env.TAILSCALE_OAUTH_CLIENT_ID);
let migTailscaleKey: pulumi.Output<string>;
if (haveTsApi) {
    const ephKey = new tailscale.TailnetKey(`nomad-cluster-spot-${stack}-ephemeral`, {
        ephemeral:     true,    // device auto-removed shortly after it goes offline
        reusable:      true,    // one key serves the whole MIG over many instances
        preauthorized: true,    // node joins without manual admin approval
        tags:          ["tag:nomad"],
        expiry:        7776000, // 90d key validity (Tailscale max); rotate via `pulumi up`
        description:   `nomad-cluster spot-compute ${stack} — ephemeral preauth node key`,
    });
    migTailscaleKey = ephKey.key;
} else {
    // No API cred → use spot-compute:tailscaleKeyEphemeral if set, else the
    // persistent key. EITHER WAY this key must be ephemeral for nodes to auto-untrack.
    migTailscaleKey = (cfg.getSecret("tailscaleKeyEphemeral") ?? tailscaleKey) as pulumi.Output<string>;
}

// ── Network: egress-only (no public IPs), mesh via Tailscale ───────────────
const network = new gcp.compute.Network(`nomad-cluster-spot-${stack}-vpc`, {
    project, autoCreateSubnetworks: false,
});
const subnet = new gcp.compute.Subnetwork(`nomad-cluster-spot-${stack}-sn`, {
    project, region, network: network.id, ipCidrRange: "10.40.0.0/24",
});
const router = new gcp.compute.Router(`nomad-cluster-spot-${stack}-router`, {
    project, region, network: network.id,
});
new gcp.compute.RouterNat(`nomad-cluster-spot-${stack}-nat`, {
    project, region, router: router.name,
    natIpAllocateOption:            "AUTO_ONLY",
    sourceSubnetworkIpRangesToNat:  "ALL_SUBNETWORKS_ALL_IP_RANGES",
});
new gcp.compute.Firewall(`nomad-cluster-spot-${stack}-iap-ssh`, {
    project, network: network.id, direction: "INGRESS",
    sourceRanges: ["35.235.240.0/20"],   // Google IAP TCP forwarding
    targetTags:   ["nomad-cluster-spot-compute"],
    allows:       [{ protocol: "tcp", ports: ["22"] }],
});

// ── Autoscaler service account (manages the MIGs) ──────────────────────────
const asSa = new gcp.serviceaccount.Account(`nomad-cluster-spot-${stack}-as`, {
    project, accountId: `nomad-cluster-spot-${stack}-as`,
    displayName: "Nomad Autoscaler (spot MIG scaler)",
});
new gcp.projects.IAMMember(`nomad-cluster-spot-${stack}-as-instanceadmin`, {
    project, role: "roles/compute.instanceAdmin.v1",
    member: pulumi.interpolate`serviceAccount:${asSa.email}`,
});
// Needed so the autoscaler can (re)create MIG instances that run as the
// instance template's service account.
new gcp.projects.IAMMember(`nomad-cluster-spot-${stack}-as-sauser`, {
    project, role: "roles/iam.serviceAccountUser",
    member: pulumi.interpolate`serviceAccount:${asSa.email}`,
});

// ── Spot MIGs (one per machine size) ───────────────────────────────────────
const migPolicies: MigPolicy[] = [];
for (const g of nodeGroups) {
    const m = new SpotPoolMig(`nomad-cluster-${stack}-${g.nodeClass}`, {
        project, region, subnetwork: subnet.id,
        machineType: g.machineType, cpus: g.cpus, memGb: g.memGb,
        nodeClass: g.nodeClass, minSize: g.min,
        nomadVersion, prodServerJoin, datacenter, nodePool, localitySite,
        nfWorkPath, scratchPath, dataDiskGb,
        tailscaleKey: migTailscaleKey,   // ephemeral key → reclaimed nodes auto-untrack
    }, { dependsOn: [subnet] });
    migPolicies.push({ migName: m.migName, nodeClass: g.nodeClass, min: g.min, max: g.max, target: g.target });
}

// ── Autoscaler VM (always-on; scales the MIGs against aither) ──────────────
const autoscaler = new AutoscalerVm(`nomad-cluster-${stack}-autoscaler`, {
    project, region, zone, subnetwork: subnet.id,
    serviceAccountEmail: asSa.email,
    autoscalerVersion: autoscalerVer,
    aitherNomadAddr, nomadToken, tailscaleKey,
    tailscaleHostname: `nomad-cluster-${stack}-autoscaler`,
    migs: migPolicies,
    cooldown: scaleInCooldown,
}, { dependsOn: [subnet] });

// ── Outputs ────────────────────────────────────────────────────────────────
export const fleet = nodeGroups.map(g =>
    `${g.nodeClass}: ${g.machineType} (${g.cpus}c/${g.memGb}G) min=${g.min} max=${g.max}`);
export const migNames = migPolicies.map(m => m.migName);
export const joinTarget = pulumi.interpolate`${datacenter}/${nodePool} via ${prodServerJoin}`;
export const autoscalerIp = autoscaler.privateIp;
