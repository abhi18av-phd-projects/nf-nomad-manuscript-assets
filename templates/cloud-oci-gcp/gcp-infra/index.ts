import * as pulumi from "@pulumi/pulumi";
import {GcpStack} from "./Gcp";

const stackName = pulumi.getStack()

const stack = new GcpStack(stackName);
export const nomadIp = stack.nomadIp;
export const clientIps = stack.clientIps;
