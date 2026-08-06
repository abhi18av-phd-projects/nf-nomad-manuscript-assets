import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as command from "@pulumi/command";
import * as random from "@pulumi/random";
import * as tailscale from "@pulumi/tailscale";
import { getPublicKey, getScript } from "./Util";
import { NomadServer } from "./gcp/NomadServer";
import { NomadClient } from "./gcp/NomadClient";
import { NomadSpotPool } from "./gcp/NomadSpotPool";

const publicKey = getPublicKey();

// GCP Johannesburg region and zone
const REGION = "africa-south1";
const ZONE   = "africa-south1-a";
const PRIVATE_SUBNET_CIDR = "10.0.2.0/24";

export class GcpStack extends pulumi.ComponentResource {

    public readonly nomadIp: pulumi.Output<string>;
    public readonly clientIps: pulumi.Output<string>[];

    constructor(public stack: string) {
        super("abc:cluster::GcpStack", `GcpStack-${stack}`, {}, {});

        const config    = new pulumi.Config();
        const gcpConfig = new pulumi.Config("gcp");

        const tailscaleKey = config.requireSecret('tailscaleKey').apply((value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                throw new Error("Config key 'tailscaleKey' is empty.");
            }
            return trimmed;
        });

        // ── Feature flags ───────────────────────────────────────────────────
        const enableOsLogin         = config.getBoolean('enableOsLogin')         ?? false;

        // ── Scaling parameters ──────────────────────────────────────────────
        // Standalone Nomad on-demand clients (fixed pool, count set in config).
        const nomadClientCount      = config.getNumber('nomadClientCount')      ?? 0;
        // Spot pool: managed by Nomad Autoscaler via GCP MIG (min=0, max configurable).
        const spotPoolMaxSize       = config.getNumber('spotPoolMaxSize')       ?? 3;
        // Cluster worker counts (default 1 — min 1 when cluster is enabled).
        // ── Cluster config ──────────────────────────────────────────────────
        // Nomad management token for the autoscaler → used when ACLs are enabled
        // (e.g. when joinSunAither=true and sun-aither owns the ACL state).
        const autoscalerNomadToken = config.getSecret('autoscalerNomadToken');

        // Nomad client token for spot-pool node registration (abc-gcp-node-policy).
        // Used by the nomad-drain service on spot instances to drain the node before preemption.
        const spotPoolNodeToken = config.getSecret('spotPoolNodeToken');

        // ── Nomad federation ────────────────────────────────────────────────
        const joinSunAither      = config.getBoolean('joinSunAither')      ?? false;
        const sunAitherServerJoin = config.getObject<string[]>('sunAitherServerJoin') ?? [];
        if (joinSunAither && sunAitherServerJoin.length === 0) {
            throw new Error("joinSunAither=true but sunAitherServerJoin is empty.");
        }

        const project = gcpConfig.require("project");

        // ── Tailscale cleanup on stack destroy ──────────────────────────────
        const nomadServerHostname      = `abc-${stack}-nomad-server`;
        const pruneTailscaleOrphansName = `abc-${stack}-prune-tailscale-orphans`;
        const tailscaleCleanupSnapshot  = process.env.TAILSCALE_API_KEY && process.env.TAILSCALE_TAILNET
            ? pulumi.output(tailscale.getDevices({ namePrefix: `abc-${stack}-` })).apply((result) =>
                JSON.stringify(result.devices.map((device) => ({
                    id:       device.id,
                    hostname: device.hostname,
                    name:     device.name,
                })))
              )
            : pulumi.output("[]");

        const pruneTailscaleOrphans = new command.local.Command(pruneTailscaleOrphansName, {
            create: "true",
            delete: `scripts/tailscale/prune-orphan-devices.sh --stack ${stack} --project ${project} --prefix abc-${stack}- --apply`,
            environment: {
                TAILSCALE_API_KEY:        process.env.TAILSCALE_API_KEY ?? "",
                TAILNET:                  process.env.TAILNET ?? "",
                TAILNET_DEVICE_LIST_JSON: tailscaleCleanupSnapshot,
            },
            interpreter: ["/bin/bash", "-c"],
            logging: "none",
        }, { parent: this });

        pulumi.runtime.registerStackTransformation((args) => {
            if (args.name === pruneTailscaleOrphansName) {
                return undefined;
            }
            const existingDependsOn = (args.opts?.dependsOn ?? []) as pulumi.Resource[];
            return {
                props: args.props,
                opts: {
                    ...args.opts,
                    dependsOn: [...existingDependsOn, pruneTailscaleOrphans],
                },
            };
        });

        // ── VPC Network ─────────────────────────────────────────────────────
        const network = new gcp.compute.Network(`abc-${stack}-vpc`, {
            name:                 `abc-${stack}-vpc`,
            project:              project,
            autoCreateSubnetworks: false,
            description:          `Nomad cluster VPC for stack ${stack}`,
        });

        // ── Private subnet (all VMs) ────────────────────────────────────────
        const privateSubnet = new gcp.compute.Subnetwork(`abc-${stack}-priv-sn`, {
            name:                 `abc-${stack}-priv-sn`,
            project:              project,
            region:               REGION,
            network:              network.id,
            ipCidrRange:          PRIVATE_SUBNET_CIDR,
            privateIpGoogleAccess: true,
        });

        // ── Cloud Router + NAT (private subnet egress) ──────────────────────
        const router = new gcp.compute.Router(`abc-${stack}-router`, {
            name:    `abc-${stack}-router`,
            project: project,
            region:  REGION,
            network: network.id,
        });

        new gcp.compute.RouterNat(`abc-${stack}-nat`, {
            name:                          `abc-${stack}-nat`,
            project:                       project,
            router:                        router.name,
            region:                        REGION,
            natIpAllocateOption:           "AUTO_ONLY",
            sourceSubnetworkIpRangesToNat: "LIST_OF_SUBNETWORKS",
            subnetworks: [{
                name:                  privateSubnet.id,
                sourceIpRangesToNats:  ["ALL_IP_RANGES"],
            }],
        });

        // ── Firewall: internal Nomad RPC/Serf within private subnet ─────────
        new gcp.compute.Firewall(`abc-${stack}-priv-internal-fw`, {
            name:    `abc-${stack}-priv-internal-fw`,
            project: project,
            network: network.id,
            allows: [
                { protocol: "tcp", ports: ["4646-4648"] },
                { protocol: "udp", ports: ["4648"] },
            ],
            sourceRanges: [PRIVATE_SUBNET_CIDR],
            targetTags:   ["nomad-private"],
        });

        // ── Spot Pool (MIG, autoscaler-managed) ────────────────────────────
        // The MIG name is deterministic — the server's autoscaler config
        // references it by name, so it must be computed before the server.
        const spotPoolName = `abc-${stack}-spot`;
        const spotPool = new NomadSpotPool(spotPoolName, {
            project:            project,
            region:             REGION,
            subnetwork:         privateSubnet.id,
            network:            network.id,
            serverHostname:     nomadServerHostname,
            tailscaleKey:       tailscaleKey,
            spotPoolNodeToken:  spotPoolNodeToken,
            enableOsLogin:      enableOsLogin,
            stack:              stack,
            minSize:            0,
            maxSize:            spotPoolMaxSize,
        }, {
            dependsOn: [privateSubnet, router],
        });

        // ── Nomad Server ────────────────────────────────────────────────────
        const nomadServer = new NomadServer(`abc-${stack}-nomad-server`, {
            project:              project,
            zone:                 ZONE,
            subnetwork:           privateSubnet.id,
            tailscaleKey:         tailscaleKey,
            enableOsLogin:        enableOsLogin,
            stack:                stack,
            joinSunAither:        joinSunAither,
            sunAitherServerJoin:  sunAitherServerJoin,
            autoscaler: {
                migName:    spotPool.migName,
                gcpProject: project,
                gcpRegion:  REGION,
                minSize:    1,
                maxSize:    spotPoolMaxSize,
                nomadToken: autoscalerNomadToken,
            },
        }, {
            dependsOn: [privateSubnet, router, spotPool],
        });

        // ── Nomad On-Demand Clients ─────────────────────────────────────────
        const nomadClients: NomadClient[] = [];
        for (let i = 0; i < nomadClientCount; i++) {
            const client = new NomadClient(`abc-${stack}-nomad-client-${i}`, {
                project:        project,
                zone:           ZONE,
                subnetwork:     privateSubnet.id,
                serverHostname: nomadServerHostname,
                tailscaleKey:   tailscaleKey,
                enableOsLogin:  enableOsLogin,
                stack:          stack,
                index:          i,
                nodeClass:      "gcp-ondemand",
                aclEnabled:     !joinSunAither,
            }, {
                dependsOn: [nomadServer],
            });
            nomadClients.push(client);
        }

        // ── Outputs ─────────────────────────────────────────────────────────
        this.nomadIp          = nomadServer.ip;
        this.clientIps        = nomadClients.map(c => c.ip);

        this.registerOutputs({
            nomadIp:        this.nomadIp,
            clientIps:      this.clientIps,
        });
    }
}
