import * as pulumi from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";
import * as command from "@pulumi/command";
import {getPrivateKey, getPublicKey, getScript} from "./Util";
import {NomadServer} from "./oci/NomadServer";
import {Bastion} from "./oci/Bastion";
import {NomadClient} from "./oci/NomadClient";

const publicKey = getPublicKey()
const privateKey = getPrivateKey()

export class OciStack extends pulumi.ComponentResource{

    public readonly publicIp: pulumi.Output<string>;
    public readonly nomadIp: pulumi.Output<string>;
    public readonly remoteLog: pulumi.Output<string>;
    public readonly clientIps : pulumi.Output<string>[];
    public readonly nomadToken : pulumi.Output<string>;

    constructor(public stack: string) {
        super("nomadcluster:cluster::OciStack", `OciStack-${stack}`, {}, {});

        const config = new pulumi.Config();
        const domainName = config.get('domainName') || 'dev.<YOUR_DOMAIN>';
        const tailscaleKey = config.get('tailscaleKey');

        const compartmentOcid = config.require("compartmentOcid");

        const availabilityDomains = oci.identity.getAvailabilityDomains({
            compartmentId: compartmentOcid,
        });

        const targetDomain = availabilityDomains.then(res =>
            res.availabilityDomains[0].name);

        const services = oci.core.getServices({
            filters: [{
                name: "name",
                values: [`All ([A-Z]+) Services In Oracle Services Network`],
                regex: true
            }]
        })

        const latestUbuntuLinux = oci.core.getImages({
            compartmentId: compartmentOcid,
            displayName: 'Canonical-Ubuntu-24.04-aarch64-2026.01.29-0',
            sortBy: "TIMECREATED",
            sortOrder: "DESC",
        });

        const latestClientUbuntuLinux = oci.core.getImages({
            compartmentId: compartmentOcid,
            displayName: 'Canonical-Ubuntu-24.04-2026.01.29-0',
            sortBy: "TIMECREATED",
            sortOrder: "DESC",
        });

        const ubuntuImageId = latestUbuntuLinux.then(img => img.images[0].id);
        const ubuntuClientImageId = latestClientUbuntuLinux.then(img => img.images[0].id);

        const vcn = new oci.core.Vcn(`nomad-cluster-${stack}-vcn`, {
            compartmentId: compartmentOcid,
            cidrBlock: "10.0.0.0/16",
            displayName: `nomad-cluster-${stack}-vcn`,
        });

        const natGateway = new oci.core.NatGateway(`nomad-cluster-${stack}-nat`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-nat`,
        });

        const gw = new oci.core.InternetGateway(`nomad-cluster-${stack}-gw`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-gw`,
            enabled: true,
        });

        const serviceGateway = new oci.core.ServiceGateway(`nomad-cluster-${stack}-srv-gw`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            services: [{
                serviceId: services.then(list => list.services[0].id),
            }],
            displayName: `nomad-cluster-${stack}-srv-gw`,
        }, {});


//------------------------------------------

        const rtPrivate = new oci.core.RouteTable(`nomad-cluster-${stack}-priv-rt`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-priv-rt`,
            routeRules: [
                {
                    destination: "0.0.0.0/0",
                    destinationType: "CIDR_BLOCK",
                    networkEntityId: natGateway.id,
                },
                {
                    destination: services.then(list => list.services[0].cidrBlock),
                    destinationType: "SERVICE_CIDR_BLOCK",
                    networkEntityId: serviceGateway.id,
                }
            ],
        }, {
            dependsOn: [natGateway],
        });

        const slPrivate = new oci.core.SecurityList(`nomad-cluster-${stack}-priv-sg`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-priv`,
            egressSecurityRules: [{
                destination: "0.0.0.0/0",
                protocol: "all",
            }],
            ingressSecurityRules: [
                {protocol: "6", source: "10.0.1.0/24", tcpOptions: {min: 22, max: 22}},
                {protocol: "6", source: "10.0.1.0/24", tcpOptions: {min: 8080, max: 8080}},
                {protocol: "6", source: "10.0.1.0/24", tcpOptions: {min: 4646, max: 4646}},
                {protocol: "6", source: "10.0.2.0/24", tcpOptions: {min: 4646, max: 4648}},
            ]
        });


        const sbPrivate = new oci.core.Subnet(`nomad-cluster-${stack}-priv-sn`, {
            compartmentId: compartmentOcid,
            cidrBlock: '10.0.2.0/24',
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-priv-sb`,
            prohibitPublicIpOnVnic: true,
            prohibitInternetIngress: true,
            routeTableId: rtPrivate.id,
            securityListIds: [slPrivate.id],
        }, {
            dependsOn: [serviceGateway]
        });

        const nomadServer = new NomadServer(`nomad-cluster-${stack}-nomad-server`, {
            compartmentId: compartmentOcid,
            subnet: sbPrivate.id,
            targetAD: targetDomain,
            imageId: ubuntuImageId,
        },{
            dependsOn: [sbPrivate]
        });

        const clientCount = config.getNumber("nomadClientCount") ?? 2;
        const nomadClients = [];
        for (let i = 0; i < clientCount; i++) {
            const client = new NomadClient(`nomad-cluster-${stack}-nomad-client-${i}`, {
                compartmentId: compartmentOcid,
                subnet: sbPrivate.id,
                targetAD: targetDomain,
                imageId: ubuntuClientImageId,
                serverIp: nomadServer.ip,
            }, {
                dependsOn: [nomadServer]
            });
            nomadClients.push(client);
        }

        //------------------------------------------
        const rtTable = new oci.core.RouteTable(`nomad-cluster-${stack}-pub-rt`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-pub-rt`,
            routeRules: [{
                networkEntityId: gw.id,
                destination: "0.0.0.0/0",
                destinationType: "CIDR_BLOCK",
            }]
        });

        const sgList = new oci.core.SecurityList(`nomad-cluster-${stack}-pub-sg`, {
            compartmentId: compartmentOcid,
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-pub-sg`,
            egressSecurityRules: [{
                destination: "0.0.0.0/0",
                protocol: "all",
                destinationType: "CIDR_BLOCK",
                stateless: false,
            }],
            ingressSecurityRules: [
                {protocol: "6", source: "0.0.0.0/0", tcpOptions: {min: 80, max: 80}},
                {protocol: "6", source: "0.0.0.0/0", tcpOptions: {min: 443, max: 443}},
                {protocol: "6", source: "0.0.0.0/0", tcpOptions: {min: 22, max: 22}},
            ]
        });

        const sbPublic = new oci.core.Subnet(`nomad-cluster-${stack}-pub-sn`, {
            compartmentId: compartmentOcid,
            cidrBlock: '10.0.1.0/24',
            vcnId: vcn.id,
            displayName: `nomad-cluster-${stack}-pub`,
            routeTableId: rtTable.id,
            securityListIds: [sgList.id],
            prohibitPublicIpOnVnic: false,
            prohibitInternetIngress: false,
        });

        const bastion = new Bastion(`nomad-cluster-${stack}-bastion`, {
            compartmentId: compartmentOcid,
            subnet: sbPublic.id,
            targetAD: targetDomain,
            imageId: ubuntuImageId,
            domainName: domainName,
            nomadServerIpAddress: nomadServer.ip,
        },{
            dependsOn: [sbPublic, nomadServer]
        });

        //------------------------------------------

        const tailPrivateCloudInit = new command.remote.Command("tailCloudInit", {
            connection: {
                host: nomadServer.ip,
                user: "ubuntu",
                privateKey: privateKey,
                proxy: {
                    host: bastion.ip,
                    privateKey: privateKey,
                    user: "ubuntu",
                }
            },
            create: `
                timeout 600s bash -c '
                    until [ -f /var/log/cloud-init-output.log ]; do sleep 2; done;
                    sudo tail -n +1 -f /var/log/cloud-init-output.log | grep -m 1 "Completed"
                '
            `,
        }, { dependsOn: [bastion, nomadServer] });

        const nomadTokenCmd = new command.remote.Command("nomad-token", {
            connection: {
                host: nomadServer.ip,
                user: "ubuntu",
                privateKey: privateKey,
                proxy: {
                    host: bastion.ip,
                    privateKey: privateKey,
                    user: "ubuntu",
                }
            },
            create: `
                sudo cat /etc/nomad.d/secrets/client-token.txt
            `,
        }, {dependsOn: [tailPrivateCloudInit]});
        this.nomadToken = nomadTokenCmd.stdout;


        const traefikHcl = getScript('nomad/traefik.hcl');
        const webHcl = getScript('nomad/web.hcl');
        const hclCommad = pulumi.all([this.nomadToken]).apply((nomadToken)=>{
            return `
cat <<'HCL_EOF' > traefik.hcl
${traefikHcl}
HCL_EOF

cat <<'HCL_EOF' > web.hcl
${webHcl}
HCL_EOF

NOMAD_TOKEN=${nomadToken} nomad job run traefik.hcl
NOMAD_TOKEN=${nomadToken} nomad job run web.hcl
            `

        })
        new command.remote.Command("traefik", {
            connection: {
                host: nomadServer.ip,
                user: "ubuntu",
                privateKey: privateKey,
                proxy: {
                    host: bastion.ip,
                    privateKey: privateKey,
                    user: "ubuntu",
                }
            },
            create: hclCommad,
        }, {dependsOn: [nomadTokenCmd]});

        if( tailscaleKey !== "") {
            const tailscale = new command.remote.Command("tailscale", {
                connection: {
                    host: nomadServer.ip,
                    user: "ubuntu",
                    privateKey: privateKey,
                    proxy: {
                        host: bastion.ip,
                        privateKey: privateKey,
                        user: "ubuntu",
                    }
                },
                create: `
                curl -fsSL https://tailscale.com/install.sh | sudo sh
                sudo tailscale up --auth-key=${tailscaleKey} --hostname=nomad-cluster-${stack}-nomad-server                
            `,
            }, {dependsOn: [tailPrivateCloudInit]});

            this.remoteLog = tailscale.stdout;
        }else {
            this.remoteLog = tailPrivateCloudInit.stdout;
        }

        //------------------------------------------
        this.publicIp = bastion.ip;
        this.nomadIp = nomadServer.ip;
        this.clientIps = nomadClients.map(c => c.ip);
        this.registerOutputs();
    }
}
