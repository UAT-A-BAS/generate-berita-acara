import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.lastIndexOf("<script>");
const end = html.lastIndexOf("</script>");
if (start === -1 || end <= start) throw new Error("Inline application script not found");

new Function(html.slice(start + "<script>".length, end));

