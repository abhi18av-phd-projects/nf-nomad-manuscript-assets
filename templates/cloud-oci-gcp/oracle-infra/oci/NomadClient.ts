import * as pulumi from "@pulumi/pulumi";
import {Input} from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";
import {getScript, getPublicKey, getPrivateKey} from "../Util";

interface NomadClientArgs {
    compartmentId: string;
    targetAD: Input<string>;
    subnet: Input<string>;
    imageId: Input<string>;
    serverIp: Input<string>;
}

const publicKey = getPublicKey()
const privateKey = getPrivateKey()

export class NomadClient extends pulumi.ComponentResource {

    public readonly id: pulumi.Output<string>;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: NomadClientArgs, opts?: pulumi.ComponentResourceOptions) {
        super("nomadcluster:cluster:oci::NomadClient", name, {}, opts);

        const userData = pulumi.all([args.serverIp]).apply(([serverIp]) => {
            return getScript('cloud-init-nomad-client.yml', {
                publicKey: publicKey,
                privateKey: privateKey,
                consul_version: "1.18.0",
                nomad_version: "1.11.2",
                nomad_server_ip: serverIp,
                arch: 'amd64',
            });
        });

        const userDataBase64 = userData.apply(scriptText =>
            Buffer.from(scriptText).toString("base64")
        );

        const vm = new oci.core.Instance(name, {
            displayName: name,
            compartmentId: args.compartmentId,
            availabilityDomain: args.targetAD,
            shape: "VM.Standard3.Flex",
            shapeConfig:{
                ocpus: 1,
                memoryInGbs: 16,
            },
            createVnicDetails: {
                subnetId: args.subnet,
                assignPublicIp: `false`,
            },
            sourceDetails: {
                sourceType: "image",
                sourceId: args.imageId,
            },
            metadata: {
                ssh_authorized_keys: publicKey,
                user_data: userDataBase64,
            },
        });

        this.ip = vm.privateIp;
        this.id = vm.id;

        this.registerOutputs();
    };

}