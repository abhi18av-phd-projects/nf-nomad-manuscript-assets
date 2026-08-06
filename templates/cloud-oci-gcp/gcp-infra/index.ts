import * as pulumi from "@pulumi/pulumi";
import {GcpStack} from "./Gcp";

const stackName = pulumi.getStack()

const stack = new GcpStack(stackName);
export const nomadIp = stack.nomadIp;
export const clientIps = stack.clientIps;
export const slurmEnabled = stack.slurmEnabledOutput;
export const slurmCtrlIp = stack.slurmCtrlIp;
export const slurmWorkerIps = stack.slurmWorkerIps;
export const slurmNomadAddr = stack.slurmNomadAddr;
export const pbsEnabled = stack.pbsEnabledOutput;
export const pbsCtrlIp = stack.pbsCtrlIp;
export const pbsNomadAddr = stack.pbsNomadAddr;
