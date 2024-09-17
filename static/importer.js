(async function(me) {
	if (!("Module" in window)) Module = {}
	if (!(Module["preRun"])) Module["preRun"] = []
	var xhr = new XMLHttpRequest()
	xhr.open("GET", "/gpworks.zip")
	xhr.responseType = "arraybuffer"
	xhr.send()
	await new Promise(function(reso, reje) {
		xhr.onload = reso
		xhr.onerror = reje
	})
	var buf = xhr.response
	if (Object.prototype.toString.call(buf) != "[object ArrayBuffer]") {
		Module.printErr("response from zip not an ArrayBuffer")
		return
	}
	var zip = await JSZip.loadAsync(buf)
	var dirs = []
	var fils = []
	zip.forEach(function(a, b) {
		if (b.dir) {
			dirs.push(a)
			return
		}
		fils.push([a, b])
	})
	fils = (await Promise.allSettled(fils.map(async function([a, b]) {
		return [a, await b.async("uint8array")]
	}))).map(function(a) {return a.value})
	Module["preRun"].push(function() {
		dirs.forEach(function(a) {Module["FS_createPath"]("/", a, true, true)})
		fils.forEach(function([a, b]) {
			Module["FS_createDataFile"](a.split("/").slice(0, -1).join("/"), a.split("/").reverse()[0], b, true, true, true)
		})
	})
	var run = document.createElement("script")
	run.src = "./gp.js" + new URL(me.src, location.origin).search
	document.head.appendChild(run)
	void(function(a, b) {
		window.onerror = function(...c) {
			a(...c)
			Module["setStatus"] = b
		}
	})(window.onerror, Module["setStatus"])
	window.onbeforeunload = function(e) {
		e.preventDefault()
		e.returnValue = ""
		return true
	}
})(document.currentScript)