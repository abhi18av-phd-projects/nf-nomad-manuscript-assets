import * as pulumi from "@pulumi/pulumi";
import {OciStack} from "./Oracle";

const stackName = pulumi.getStack()

const stack = new OciStack(stackName);

export const outputs = stack
