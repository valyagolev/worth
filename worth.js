import { promises as fs } from "fs";
async function main() {
    console.log("--- START ---");
    const value = await fs.open("test/euler/1.wf");
    console.log(value);
}
await main();
//# sourceMappingURL=worth.js.map