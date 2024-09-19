module.exports = function(a) {
	var b = new RegExp("\\(function\\(\\){.*}\\)\\(\\)", "g")
	var c = a.replace(b, function(c) { // `String.replace` only replaces first occurence, fits for this use case.
		return (((c.includes("gp_js.data")) || (c.includes("gp_wasm.data"))) && (c.includes("loadPackage")) && (c.includes("Module[\"FS_createPath\"]"))) ? "/* idoicy */" : c
	})
	// console.log(c.split("/* Possible FS insertion removed! */").length - 1)
	return c
}