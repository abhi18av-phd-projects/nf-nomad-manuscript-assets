import * as fs from "node:fs";
import * as path from "node:path";

export const getPublicKey =  ()=> fs.readFileSync(`id_ed25519.pub`, "utf-8").trim();

export const getPrivateKey =  ()=> fs.readFileSync(`id_ed25519`, "utf-8");

export const getSshKeysMetadata = () => {
    const publicKey = getPublicKey();
    const keys = [`ubuntu:${publicKey}`];
    const localUser = (process.env.USER || "").trim().replace(/[^a-zA-Z0-9._-]/g, "");
    if (localUser && localUser !== "ubuntu") {
        keys.push(`${localUser}:${publicKey}`);
    }
    return keys.join("\n");
}

export const getScript = (name: string, args?:any) => {
    let ret = fs.readFileSync(path.join(__dirname, "scripts", name), "utf-8");
    if(args) {
        for(const key in args) {
            const value = args[key];
            ret = ret.replaceAll("${" + key + "}", value);
        }
    }
    return ret;
}
