import * as pulumi from "@pulumi/pulumi";
import {Input} from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";
import {getScript, getPublicKey, getPrivateKey} from "../Util";

interface BastionArgs {
    compartmentId: string;
    targetAD: Input<string>;
    subnet: Input<string>;
    imageId: Input<string>;
    domainName: Input<string>;
    nomadServerIpAddress: Input<string>;
}

const publicKey = getPublicKey()
const privateKey = getPrivateKey()

export class Bastion extends pulumi.ComponentResource {

    public readonly id: pulumi.Output<string>;
    public readonly ip: pulumi.Output<string>;

    constructor(name: string, args: BastionArgs, opts?: pulumi.ComponentResourceOptions) {
        super("nomadcluster:cluster:oci::Bastion", name, {}, opts);


        const userData = pulumi.all([args.nomadServerIpAddress]).apply(([nomadServerIpAddress]) => {
            return getScript('cloud-init-bastion.yml',{
                publicKey: publicKey,
                privateKey: privateKey,
                caddy_instance: 1,
                domain_name: args.domainName,
                nomadServerIpAddress: nomadServerIpAddress,
            })
        });
        const userDataBase64 = userData.apply(scriptText =>
            Buffer.from(scriptText).toString("base64")
        );


        const vm = new oci.core.Instance(name, {
            displayName: name,
            compartmentId: args.compartmentId,
            availabilityDomain: args.targetAD,
            shape: "VM.Standard.A1.Flex",
            shapeConfig:{
                ocpus: 1,
                memoryInGbs: 4,
            },
            createVnicDetails: {
                subnetId: args.subnet,
                assignPublicIp: `true`,
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

        this.ip = vm.publicIp;
        this.id = vm.id;

        this.registerOutputs();
    };

}