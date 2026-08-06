import * as pulumi from "@pulumi/pulumi";
import {Input} from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";
import {getScript, getPublicKey, getPrivateKey} from "../Util";

interface NomadServerArgs {
    compartmentId: string;
    targetAD: Input<string>;
    subnet: Input<string>;
    imageId: Input<string>;
}

const publicKey = getPublicKey()
const privateKey = getPrivateKey()

export class NomadServer extends pulumi.ComponentResource {

    public readonly id: pulumi.Output<string>;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: NomadServerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("abc:cluster:oci::NomadServer", name, {}, opts);

        const cloudInit = getScript('cloud-init-nomad-server.yml',{
            publicKey: publicKey,
            privateKey: privateKey,
            consul_version: "1.18.0",
            nomad_version: "1.11.2",
            nomad_server_count: 1,
            arch: 'arm64',
        });

        const vm = new oci.core.Instance(name, {
            displayName: name,
            compartmentId: args.compartmentId,
            availabilityDomain: args.targetAD,
            shape: "VM.Standard.A1.Flex",
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
                user_data: btoa(cloudInit),
            },
        });

        this.ip = vm.privateIp;
        this.id = vm.id;

        this.registerOutputs();
    };

}