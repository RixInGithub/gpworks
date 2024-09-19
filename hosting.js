rmFS = require("./rmFS.js")
request = require("request")
express = require("express")
JSZip = require("jszip")
fs = require("fs")
afs = fs.promises

app = express()

async function dir2Zip(a) {
	var zip = new JSZip()
	async function work(a, b) {
		var c = await afs.readdir(a)
		for (var d of c) {
			var e = require("path").join(a, d)
			var f = await afs.stat(e)
			if (f.isDirectory()) {
				var subfolder = b.folder(d)
				await work(e, subfolder)
			} else {
				b.file(d, await afs.readFile(e))
			}
		}
	}
	await work(a, zip)
	return await zip.generateAsync({type: "nodebuffer"})
}

app.use(express.static("static"))

app.get("/emModule.js", async function(req, res) {
	var resp = (await (require("util").promisify(request))("https://gpblocks.org/run/emModule.js", {encoding: null}))
	res.header("content-type", resp.headers["content-type"])
	res.send(resp.body)
})

app.get("/FileSaver.js", async function(req, res) {
	var resp = (await (require("util").promisify(request))("https://gpblocks.org/run/FileSaver.js", {encoding: null}))
	res.header("content-type", resp.headers["content-type"])
	res.send(resp.body)
})

app.get("/gp.js", async function(req, res) {
	var url = `https://gpblocks.org/run/gp_${"wasm" in req.query ? "wasm" : "js"}.js`
	console.log(url)
	var resp = (await (require("util").promisify(request))(url, {encoding: "utf8"}))
	res.header("content-type", resp.headers["content-type"])
	res.send(rmFS(resp.body))
})

app.get("/gp_wasm.wasm", async function(req, res) {
	var resp = (await (require("util").promisify(request))("https://gpblocks.org/run/gp_wasm.wasm", {encoding: null}))
	res.header("content-type", resp.headers["content-type"])
	res.send(resp.body)
})

app.get("/gpworks.zip", async function(req, res) {
	res.header("content-type", "application/zip")
	res.send(await dir2Zip("gpworks"))
})

app.listen(8080)