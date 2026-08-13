import * as pulumi from "@pulumi/pulumi";
import { Input } from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { getScript, getPublicKey, getSshKeysMetadata } from "../Util";

interface NomadServerArgs {
    project: Input<string>;
    zone: Input<string>;
    subnetwork: Input<string>;
    tailscaleKey: Input<string>;
    enableOsLogin: Input<boolean>;
    stack: string;
    /** When true, retry_join the existing sun-aither Raft instead of self-bootstrapping. */
    joinSunAither?: boolean;
    /** Tailscale IPs of existing sun-aither servers (only used when joinSunAither=true). */
    sunAitherServerJoin?: string[];
    /**
     * When provided, installs the Nomad Autoscaler on this server and points
     * it at the given GCP Managed Instance Group.
     */
    autoscaler?: {
        /** Name of the GCP MIG that the autoscaler will resize. */
        migName: string;
        /** GCP project ID. */
        gcpProject: string;
        /** GCP region (e.g. africa-south1). */
        gcpRegion: string;
        /** Minimum MIG size. Defaults to 0. */
        minSize?: number;
        /** Maximum MIG size. Defaults to 3. */
        maxSize?: number;
        /** nomad-autoscaler release version. Defaults to "0.4.9". */
        version?: string;
        /** Nomad management token for autoscaler → Nomad API calls (required when ACLs are enabled). */
        nomadToken?: Input<string>;
    };
}

const publicKey = getPublicKey();
const sshKeys   = getSshKeysMetadata();

export class NomadServer extends pulumi.ComponentResource {

    public readonly id: pulumi.Output<string>;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: NomadServerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("nomadcluster:cluster:gcp::NomadServer", name, {}, opts);

        const joinSunAither = args.joinSunAither ?? false;
        const sunAitherServerJoin = args.sunAitherServerJoin ?? [];

        // When joining an existing Raft, omit `bootstrap_expect` (rendered as commented-out)
        // so this server only retry_joins. The existing servers stay authoritative.
        const bootstrapExpectLine = joinSunAither
            ? '# bootstrap_expect omitted: joining existing sun-aither cluster'
            : `bootstrap_expect = 1`;

        // Build the server { server_join { retry_join = [...] } } stanza.
        // In joinSunAither mode this points at sun-aither; otherwise empty (single-node bootstrap).
        const retryJoinList = joinSunAither
            ? sunAitherServerJoin.map((ip) => `"${ip}"`).join(", ")
            : "";
        const serverJoinStanza = joinSunAither
            ? `        server_join {
          retry_join     = [${retryJoinList}]
          retry_max      = 0
          retry_interval = "15s"
        }`
            : "";

        // Skip the self-ACL-bootstrap when joining existing cluster.
        const aclBootstrapEnabled = joinSunAither ? "false" : "true";

        // Datacenter label so this DC is distinguishable from sun-nomadlab / oci-nomadlab.
        const datacenter = "gcp-nomadlab";

        // Autoscaler config — only installed when args.autoscaler is provided.
        const asCfg              = args.autoscaler;
        const autoscalerEnabled  = asCfg ? "true" : "false";
        const autoscalerVersion  = asCfg?.version  ?? "0.4.9";
        const migName            = asCfg?.migName   ?? "";
        const gcpProject         = asCfg?.gcpProject ?? "";
        const gcpRegion          = asCfg?.gcpRegion  ?? "";
        const spotPoolMin        = String(asCfg?.minSize ?? 0);
        const spotPoolMax        = String(asCfg?.maxSize ?? 3);

        const cloudInit = pulumi.all([args.tailscaleKey, asCfg?.nomadToken ?? ""]).apply(([tailscaleKey, autoscalerNomadToken]) =>
            getScript('cloud-init-nomad-server.yml', {
                publicKey:           publicKey,
                consul_version:      "1.18.0",
                nomad_version:       "1.11.2",
                nomad_server_count:  1,
                arch:                'amd64',
                tailscaleKey:        tailscaleKey,
                tailscaleHostname:   `nomad-cluster-${args.stack}-nomad-server`,
                bootstrapExpectLine: bootstrapExpectLine,
                serverJoinStanza:    serverJoinStanza,
                aclBootstrapEnabled: aclBootstrapEnabled,
                datacenter:          datacenter,
                // Autoscaler
                autoscalerEnabled:      autoscalerEnabled,
                autoscalerVersion:      autoscalerVersion,
                autoscalerNomadToken:   autoscalerNomadToken,
                migName:                migName,
                gcpProject:             gcpProject,
                gcpRegion:              gcpRegion,
                spotPoolMin:            spotPoolMin,
                spotPoolMax:            spotPoolMax,
            })
        );

        const vm = new gcp.compute.Instance(name, {
            name: name,
            project: args.project,
            zone: args.zone,
            // e2-custom-4-8192: 4 vCPUs, 8 GB RAM
            machineType: "e2-custom-4-8192",
            bootDisk: {
                initializeParams: {
                    image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
                    size: 50,
                    type: "pd-balanced",
                },
            },
            networkInterfaces: [{
                subnetwork: args.subnetwork,
                // No accessConfig = no public IP
            }],
            metadata: {
                "ssh-keys": sshKeys,
                "enable-oslogin": pulumi.output(args.enableOsLogin).apply((v) => v ? "TRUE" : "FALSE"),
                "user-data": cloudInit,
            },
            tags: ["nomad-private"],
            serviceAccount: {
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            },
        }, { parent: this });

        this.ip = vm.networkInterfaces.apply(ifaces => ifaces[0].networkIp!);
        this.id = vm.id;

        this.registerOutputs();
    }
}
