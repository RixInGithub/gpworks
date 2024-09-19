/*
 * See /LICENSE.txt for GP's license.
 */

// The following code decides whether to use WebAssembly or asm.js
//
// Note: In iOS 11.2.6 Safari, GP WebAssembly did not work on John's iPad Pro.
// Seemed to be an iOS Safari bug:
//   https://github.com/kripken/emscripten/issues/6042
// A fix was expected in iOS 11.3, which came out in March 2018.
// WebAssembly seems to be working in iOS 12, so workaround was removed.

var script = document.createElement('script');
script.src = "./importer.js"
if ((typeof WebAssembly === 'object') && (!(location.search.slice(location.search.indexOf("?") + 1).split("&").some(function(a) {return a.startsWith("js")})))) {
	console.log("WebAssembly supported");
	script.src += "?wasm"
} else {
	console.log("No WebAssembly");
}
document.head.appendChild(script);

// Handlers are ignored in gp.html when running as a Chrome App so must be added here:

function addGPHandlers() {
	var kbdButton = document.getElementById('KeyboardButton');
	var backspaceButton = document.getElementById('BackspaceButton');
	var fullscreenButton = document.getElementById('FullscreenButton');
	var enableMicrophoneButton = document.getElementById('EnableMicrophoneButton');
	var uploadButton = document.getElementById('UploadButton');
	var seeInsideButton = document.getElementById('SeeInsideButton');
	var presentButton = document.getElementById('PresentButton');
	var goButton = document.getElementById('GoButton');
	var stopButton = document.getElementById('StopButton');
	var fileUploader = document.getElementById('FileUploader');
	var canvas = document.getElementById('canvas');

	kbdButton.onclick = function(evt) { GP.clipboard.focus(); };
	backspaceButton.onclick = function(evt) { GP_backspace(); };
	fullscreenButton.onclick = function(evt) { GP_toggleFullscreen(); };
	uploadButton.onclick = function(evt) { GP_UploadFiles(); };
	enableMicrophoneButton.onclick = function(evt) { GP_startAudioInput(1024, 22050); };
	seeInsideButton.onclick = function(evt) { queueGPMessage('seeInside'); };
	presentButton.onclick = function(evt) { queueGPMessage('present'); };
	goButton.onclick = function(evt) { queueGPMessage('go'); };
	stopButton.onclick = function(evt) { queueGPMessage('stop'); };
	fileUploader.onchange = function(evt) { uploadFiles(fileUploader.files); };
	canvas.oncontextmenu = function(evt) { evt.preventDefault(); }
}
addGPHandlers();

// GP variables

var GP = {
	events: [],

	clipboard: null,
	clipboardBytes: [],
	droppedTextBytes: [],
	droppedFiles: [],
	messages: [],

	audioOutBuffer: null,
	audioOutIsStereo: false,
	audioOutReady: false,

	audioInBuffer: null,
	audioInDownsampling: false,
	audioInReady: false,
	audioInSource: null,
	audioInCapture: null,
};

// Add the following to the meta tags in the header to suppress scaling of the GP canvas
// <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />

// clipboard support

GP.clipboard = document.createElement('textarea');
GP.clipboard.style.position = 'absolute';
GP.clipboard.style.right = '101%'; // placed just out of view
GP.clipboard.style.top = '0px';
document.body.appendChild(GP.clipboard);

function setGPClipboard(s) {
	// Called by GP's setClipboard primitive
	GP.clipboardBytes = toUTF8Array(s);
	GP.clipboard.value = s;
	GP.clipboard.focus();
	GP.clipboard.select();
}
setGPClipboard('');

document.addEventListener(
	 // Support for the ctrl-C shortcut for 'copy'.
	 // Copy via ctrl-C is blocked on Safari; use menu command after doing GP copy operation.
	 // Paste via ctrl-V is blocked on most or all browsers.
	 // The  preventDefault() call makes all control keys available to GP.
	'keydown',
	function(evt) {
		if (evt.ctrlKey || evt.metaKey) {
			if (67 == evt.keyCode) document.execCommand('copy'); // ctrl-c keydown
			if (86 == evt.keyCode) document.execCommand('paste'); // ctrl-v keydown
			evt.preventDefault();
        }
	}
);

document.addEventListener(
	// Support for the ctrl-C shortcut for 'copy'.
	// This does a second copy operation *after* GP has updated GP.clipboard.
	'keyup',
	function(evt) {
		// Handle copy and paste keyboard shortcuts.
		if (evt.ctrlKey || evt.metaKey) {
			if (67 == evt.keyCode) document.execCommand('copy'); // ctrl-c keyup
			evt.preventDefault();
        }
	}
);

GP.clipboard.addEventListener(
	// In some browsers, copy and paste to the system clipboard only work from the browser menu.
	// Dropping a text clipping can be also used to paste text.
	'paste',
	function(evt) {
		s = evt.clipboardData.getData('text/plain');
		if (s) {
			setGPClipboard(s);
			GP.droppedTextBytes = GP.clipboardBytes;
		}
	}
);

function toUTF8Array(str) {
	// Convert a Javascript string into an array of UTF8 bytes that can be read by GP.
	var utf8 = [];
	for (var i = 0; i < str.length; i++) {
		var charcode = str.charCodeAt(i);
		if (charcode < 0x80) utf8.push(charcode);
		else if (charcode < 0x800) {
			utf8.push(
				0xc0 | (charcode >> 6),
				0x80 | (charcode & 0x3f));
		}
		else if (charcode < 0x10000) {
			utf8.push(
				0xe0 | (charcode >> 12),
				0x80 | ((charcode >> 6) & 0x3f),
				0x80 | (charcode & 0x3f));
		} else if (charcode <= 0x10FFFF) {
			utf8.push(
				0xf0 | (charcode >> 18),
				0x80 | ((charcode >> 12) & 0x3f),
				0x80 | ((charcode >> 6) & 0x3f),
				0x80 | (charcode & 0x3f));
		}
	}
	return utf8;
}

// events

function initGPEventHandlers() {
	var MOUSE_DOWN = 1;
	var MOUSE_UP = 2;
	var MOUSE_MOVE = 3;
	var MOUSE_WHEEL = 4;
	var KEY_DOWN = 5;
	var KEY_UP = 6;
	var TEXTINPUT = 7;
	var TOUCH_DOWN = 8;
	var TOUCH_UP = 9;
	var TOUCH_MOVE = 10;

	function localPoint(x, y) {
		var r = canvas.getBoundingClientRect();
		x = (x - r.left) | 0;
		y = (y - r.top) | 0;
		if (x < 0) x = 0;
		if (y < 0) y = 0;
		return [x, y];
	}
	function modifierBits(evt) {
		var modifiers = ( // SDL modifier flags (for left-side versions of those keys)
		(evt.shiftKey ? 1 : 0) |
		(evt.ctrKey ? 2 : 0) |
		(evt.altKey ? 4 : 0) |
		(evt.metaKey ? 8 : 0));
		return modifiers;
	}
	function keyEvent(evtType, evt) {
		var keyCode = evt.keyCode;
		var charCode = 0;
		if (evt.keyIdentifier) { // Safari
			if (evt.keyIdentifier.startsWith('U+')) {
				charCode = parseInt(evt.keyIdentifier.substring(2), 16);
			}
		} else if (evt.key && evt.key.charCodeAt) { // Chrome, Firefox
			if (evt.key.length == 1) {
				charCode = evt.key.charCodeAt(0);
			}
		}
		if (0 == charCode) {
			if (8 == evt.keyCode) charCode = 8; // delete
			if (9 == evt.keyCode) charCode = 9; // tab
			if (13 == evt.keyCode) charCode = 13; // enter
			if (27 == evt.keyCode) charCode = 27; // escape
		}
		if ((65 <= charCode) && (charCode <= 90) && !evt.shiftKey) charCode += 32; // lowercase

		// make Firefox keycodes the same as Chrome/Safari:
		if ((59 == keyCode) && (59 == charCode)) keyCode = 186;
		if ((61 == keyCode) && (61 == charCode)) keyCode = 187;
		if ((173 == keyCode) && (45 == charCode)) keyCode = 189;
		if (224 == keyCode) keyCode = 91;

		var modifiers = ( // SDL modifier flags (for left-side versions of those keys)
			(evt.shiftKey ? 1 : 0) |
			(evt.ctrKey ? 2 : 0) |
			(evt.altKey ? 4 : 0) |
			(evt.metaKey ? 8 : 0));

		return [evtType, keyCode, charCode, modifiers];
	}

	var canvas = document.getElementById('canvas');

	canvas.onmousedown = function(evt) {
		GP_audioContext(); // create audio context on first click
		var p = localPoint(evt.clientX, evt.clientY);
		GP.events.push([MOUSE_DOWN, p[0], p[1], evt.button, modifierBits(evt)]);
	}
	canvas.onmouseup = function(evt) {
		var p = localPoint(evt.clientX, evt.clientY);
		GP.events.push([MOUSE_UP, p[0], p[1], evt.button, modifierBits(evt)]);
	}
	canvas.onmousemove = function(evt) {
		var p = localPoint(evt.clientX, evt.clientY);
		GP.events.push([MOUSE_MOVE, p[0], p[1]]);
	}
	document.onkeydown = function(evt) {
		var key = evt.which;
		if ((13 == key) && (/Android/i.test(navigator.userAgent))) {
			// On Android, generate text input events for entire string when the enter key is pressed
			var s = GP.clipboard.value;
			for (var i = 0; i < s.length; i++) GP.events.push([TEXTINPUT, s.charCodeAt(i)]);
			if (s.length == 0) GP.events.push([TEXTINPUT, 13]); // insert newline if no other characters
			GP.clipboard.value = '';
			evt.preventDefault();
			return;
		}
		var eventRecord = keyEvent(KEY_DOWN, evt);
		GP.events.push(eventRecord);
		// suppress browser's default behavior for various keys
		if ((9 == key) || (32 == key)) { // tab or space
			GP.events.push([TEXTINPUT, key]); // suppress, but do generate a textinput event
			evt.preventDefault();
		}
		if (8 == key) evt.preventDefault(); // delete
		if ((37 <= evt.which) && (evt.which <= 40)) evt.preventDefault(); // arrow keys
		if ((112 <= evt.which) && (evt.which <= 123)) evt.preventDefault(); // function keys
	}
	document.onkeyup = function(evt) {
		GP.events.push(keyEvent(KEY_UP, evt));
	}
	document.onkeypress = function(evt) {
		var charCode = evt.charCode;
		if (evt.char && (evt.char.length == 1)) charCode = evt.char.charCodeAt(0);
		GP.events.push([TEXTINPUT, charCode]);
	}
	canvas.ontouchstart = function(evt) {
		var touch = evt.touches[evt.touches.length - 1];
		if (touch) {
			var button = (evt.touches.length == 2) ? 3 : 0;
			var p = localPoint(touch.clientX, touch.clientY);
			GP.events.push([TOUCH_DOWN, p[0], p[1], button]);
		}
		evt.preventDefault();
	}
	canvas.ontouchend = function(evt) {
		GP.events.push([TOUCH_UP, 0, 0, 0]);
		evt.preventDefault();
	}
	canvas.ontouchmove = function(evt) {
		var touch = evt.touches[evt.touches.length - 1];
		if (touch) {
			var p = localPoint(touch.clientX, touch.clientY);
			GP.events.push([TOUCH_MOVE, p[0], p[1], 0]);
		}
		evt.preventDefault();
	}
}
initGPEventHandlers();

function GP_backspace() {
	// Simulate the backspace/delete key on Android.
	var KEY_DOWN = 5;
	var KEY_UP = 6;
	GP.events.push([KEY_DOWN, 8, 8, 0]);
	GP.events.push([KEY_UP, 8, 8, 0]);
}

// drag-n-drop events

window.addEventListener(
	'dragover',
	function(evt) {
		evt.preventDefault();
	},
	false
);

window.addEventListener(
	'drop',
	function(evt) {
		evt.preventDefault();
		var files = evt.target.files || evt.dataTransfer.files;
		if (files && files.length) {
			uploadFiles(files);
		} else if (evt.dataTransfer) {
			// Dropping a text clipping or URL can be used as workaround for paste
			var s = evt.dataTransfer.getData('text/plain');
			if (s) GP.droppedTextBytes = toUTF8Array(s);
			var url = evt.dataTransfer.getData('URL');
			if (url) GP.droppedTextBytes = toUTF8Array(url + '\n');
		}
	},
	false
);

// message handling

function queueGPMessage(s) {
	// Queue a message that can be read by GP with the 'browserGetMessage' primitive
	// This mechanism is currently used by HTML buttons for 'go', 'stop', and 'see inside'.

	GP.messages.push(toUTF8Array(s));
}

function handleMessage(evt) {
	// Handle a message sent by the JavaScript postMessage() function.
	// This is used to control button visibility or to queue a message to GP.
	var msg = evt.data;
	if (typeof msg != "string") return
	if (msg.startsWith('showButton ')) {
		var btn = document.getElementById(msg.substring(11));
		if (btn) btn.style.display = 'inline';
	} else if (msg.startsWith('hideButton ')){
		var btn = document.getElementById(msg.substring(11));
		if (btn) btn.style.display = 'none';
	}
  // gpworks additions
  var parsed = msg.split(" ")
  if (parsed[parsed.length - 1] == "loaded") {
    return queueGPMessage("iframe")
  }
  queueGPMessage(msg)
}

window.addEventListener("message", handleMessage, false);

// file upload support

function GP_UploadFiles(evt) {
	var inp = document.getElementById('FileUploader'); // use the hidden file input element
	if (inp) inp.click();
}

function importFile() {
	// obsolete; not used
	function cleanup() {
		document.body.onfocus = null;
		if (inp && inp.parentNode) inp.parentNode.removeChild(inp);
	}
	var inp;
	var inputs = document.getElementsByTagName('input');
	if (inputs.length > 1) { // reuse existing file input button
		inp = inputs[1];
	} else { // create a new file input button
		inp = document.createElement('input');
		inp.type = 'file';
		inp.multiple = true;
		inp.style.marginLeft = '7px';
		inp.style.marginTop = '6px';
		var status = document.getElementById('status');
		if (status) {
			status.parentNode.insertBefore(inp, status);
		} else {
			document.body.appendChild(inp);
		}
	}
	inp.onchange = function() {
		uploadFiles(inp.files);
		cleanup();
	}
	document.body.onfocus = cleanup; // cleanup if file dialog is cancelled
}

function uploadFiles(files) {
	function recordFile(f) {
		reader = new FileReader();
		reader.onloadend = function() {
			if (reader.result) {
				GP.droppedFiles.push({ name: f.name, contents: reader.result });
			}
			if (todo.length) recordFile(todo.shift());
		};
		reader.readAsArrayBuffer(f);
	}
	var todo = [];
	if (files && files.length) {
		for (var i = 0; i < files.length; i++) todo.push(files[i]);
	    recordFile(todo.shift());
	}
}

function adjustButtonVisibility() {
	// Show the appropriate buttons in a mobile or non-mobile browser.
	var kbdButton = document.getElementById('KeyboardButton');
	var bsButton = document.getElementById('BackspaceButton');
	var fsButton = document.getElementById('FullscreenButton');
	var userAgent = navigator.userAgent;
	var isKindle = /Kindle|Silk|KFAPW|KFARWI|KFASWI|KFFOWI|KFJW|KFMEWI|KFOT|KFS‌​AW|KFSOWI|KFTBW|KFTH‌​W|KFTT|WFFOWI/i.test(userAgent);
	var isOtherMobile = /Android|webOS|iPhone|iPad|iPod|CriOS|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
	if (isKindle || isOtherMobile) {
		kbdButton.style.display = 'inline';
	} else {
		kbdButton.style.display = 'none';
	}
	if (isKindle || /Android/i.test(navigator.userAgent)) {
		bsButton.style.display = 'inline';
	} else {
		bsButton.style.display = 'none';
	}
	if (/iPhone|iPad|iPod|CriOS/i.test(userAgent)) {
		fsButton.style.display = 'none';
	} else {
		fsButton.style.display = 'inline';
	}

	if (window.parent === window) {
		document.getElementById('EnableMicrophoneButton').style.display = 'none';
	}

	// adjust buttons when opened with 'go.html' URL
	if ((typeof window !== 'undefined') && (window.location.href.includes('go.html'))) {
		document.getElementById('SeeInsideButton').style.display = 'inline';
		document.getElementById('PresentButton').style.display = 'none';
	} else if ((typeof window !== 'undefined') && (window.location.href.includes('microblocks.html'))) {
		document.getElementById('controls').style.display = 'none';
	} else {
		document.getElementById('SeeInsideButton').style.display = 'none';
		document.getElementById('PresentButton').style.display = 'inline';
	}
}
adjustButtonVisibility();

// audio input and output support

function GP_audioContext() {
	// Note: Cache the audio context because browsers only allow you to create a few of them.
	if (GP.cachedAudioContext) return GP.cachedAudioContext;

	function unsuspendAudioContext () {
		// On iOS, the audio context is suspended until resumed by a touch event.
		if (GP.cachedAudioContext &&  ('suspended' === GP.cachedAudioContext.state)) {
			GP.cachedAudioContext.resume();
		}
	}
	var AudioContextClass = (window.AudioContext || window.webkitAudioContext ||
		window.mozAudioContext || window.msAudioContext || window.oAudioContext);
	if (!AudioContextClass) {
		console.warn('This browser does not support audio');
		return null;
	}
	GP.cachedAudioContext = new AudioContextClass();
	document.body.addEventListener('touchend', unsuspendAudioContext, false);
	return GP.cachedAudioContext;
}

// iOS hack -- create the audio context at startup so a touch event
// can unsuspend the audio context before we actually need it:
//GP_audioContext();

function GP_startAudioInput(inputSampleCount, sampleRate) {
	if (GP.audioInCapture && GP.audioInSource) return; // already open

	function doSoundInput(evt) {
		var buf = evt.inputBuffer.getChannelData(0);
		if (GP.audioInDownsampling) {
			for (i = 0; i < buf.length; i += 2) {
				var n = ((buf[i] + buf[i + 1]) * 16383) | 0; // average two samples and convert to signed int (16383 is 32767 / 2)
				GP.audioInBuffer[i / 2] = n;
			}
		} else {
			for (i = 0; i < buf.length; i++) {
				GP.audioInBuffer[i] = (buf[i] * 32767) | 0; // convert to signed int
			}
		}
		GP.audioInReady = true;
	}
	function openAudioInput(stream) {
		var rawSampleCount = GP.audioInDownsampling ? (2 * inputSampleCount) : inputSampleCount;
		GP.audioInSource = audioContext.createMediaStreamSource(stream);
		GP.audioInCapture = audioContext.createScriptProcessor(rawSampleCount, 1); // will down-sample to 22050
		GP.audioInCapture.onaudioprocess = doSoundInput;
		GP.audioInSource.connect(GP.audioInCapture);
		GP.audioInCapture.connect(audioContext.destination);
	}

	audioContext = GP_audioContext();
	if (!audioContext) return;

	var data = new ArrayBuffer(2 * inputSampleCount); // two-bytes per sample
	GP.audioInBuffer = new Int16Array(data);
	GP.audioInDownsampling = (sampleRate < audioContext.sampleRate);
	GP.audioInReady = false;

	if (navigator.mediaDevices) {
		navigator.mediaDevices.getUserMedia({audio: true})
		.then(openAudioInput)
		.catch(function(err) {
			console.warn('Could not open audio input: ' + err);
		});
	} else {
		console.warn('Audio input is not supported by this browser');
	}
}

function GP_stopAudioInput() {
	if (GP.audioInSource) GP.audioInSource.disconnect();
	if (GP.audioInCapture) GP.audioInCapture.disconnect();
	GP.audioInSource = null;
	GP.audioInCapture = null;
	GP.audioInReady = false;
}

function GP_startAudioOutput(frameCount, isStereo) {
	if (GP.callbackID) return; // already open

	audioContext = GP_audioContext();
	if (!audioContext) return;

	function soundProcess() {
		if (!GP.callbackID) return; // audio output closed
		if (audioContext.currentTime <= GP.audioOutFlipTime) {
			GP.callbackID = requestAnimationFrame(soundProcess);
			return;
		}

		// select the buffer to fill and swap buffers
		var buf = GP.audioOutBuffers[GP.audioOutBufferIndex];
		GP.audioOutBufferIndex = (GP.audioOutBufferIndex + 1) % 2;

		if (GP.audioOutReady) {
			if (GP.audioOutIsStereo) { // stereo
				var left = buf.getChannelData(0);
				var right = buf.getChannelData(1);
				for (var i = 0; i < left.length; i++) {
					left[i] = GP.audioOutBuffer[2 * i];
					right[i] = GP.audioOutBuffer[(2 * i) + 1];
				}
			} else { // mono
				var samples = buf.getChannelData(0);
				for (var i = 0; i < samples.length; i++) samples[i] = GP.audioOutBuffer[i];
			}
		} else { // no GP audio data available; fill all channels with silence
			for (var chan = 0; chan < buf.numberOfChannels; chan++) {
				var samples = buf.getChannelData(chan);
				for (var i = 0; i < samples.length; i++) samples[i] = 0;
			}
		}
		GP.audioOutReady = false;

		var startTime = GP.audioOutFlipTime + buf.duration;
		if (audioContext.currentTime > startTime) startTime = audioContext.currentTime;
		var source = audioContext.createBufferSource();
		source.buffer = buf;
		source.start(startTime);
		source.connect(audioContext.destination);
		GP.audioOutFlipTime = startTime; // when this buffer starts playing, GP can fill the other one
		GP.callbackID = requestAnimationFrame(soundProcess);
	}

	var channelCount = isStereo ? 2 : 1;
	var data = new ArrayBuffer(4 * frameCount * channelCount); // four-bytes per sample (Float32's)
	GP.audioOutBuffer = new Float32Array(data);
	GP.audioOutIsStereo = isStereo;
	GP.audioOutReady = false;

	GP.audioOutBuffers = [];
	GP.audioOutBuffers.push(audioContext.createBuffer(channelCount, frameCount, 22050));
	GP.audioOutBuffers.push(audioContext.createBuffer(channelCount, frameCount, 22050));
	GP.audioOutBufferIndex = 0;
	GP.audioOutFlipTime = -1;

	GP.callbackID = requestAnimationFrame(soundProcess);
}

function GP_stopAudioOutput() {
	if (!GP.callbackID) cancelAnimationFrame(GP.callbackID);
	GP.callbackID = null;
}

function GP_toggleFullscreen() {
  var doc = window.document;
  var docEl = doc.documentElement;

  var requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
  var cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;

  if(!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
	requestFullScreen.call(docEl);
  } else {
	cancelFullScreen.call(doc);
  }
}

// Serial Ports (Chrome App Only)
// For now, only one serial port can be open at a time.

GP_serialPortNames = [];
GP_serialPortID = -1;
GP_serialInputBuffers = [];
GP_serialPortListenersAdded = false;

function GP_getSerialPorts() {
	// Request an update to the serial port list, GP_serialPortNames. Since this call
	// is asynchronous, the result is not available in GP_serialPortNames immediately.
	// The caller should call this, wait a bit, then read GP_serialPortNames.

	function listPorts(ports) {
		GP_serialPortNames = [];
		for (var i = 0; i < ports.length; i++) {
			GP_serialPortNames.push(toUTF8Array(ports[i].path));
		}
	}
	if ((typeof chrome == 'undefined') || !chrome.serial) return; // serial port API not available; do nothing
	chrome.serial.getDevices(listPorts);
}

function GP_openSerialPort(id, path, baud) {
	function serialPortError(info) {
		console.log('Serial port error: ' + info.error);
		GP_closeSerialPort();
	}
	function serialPortDataReceived(info) {
		GP_serialInputBuffers.push(new Uint8Array(info.data));
	}
	function portOpened(connectionInfo) {
		if (!connectionInfo || chrome.runtime.lastError) {
			var reason = '';
			if (chrome.runtime.lastError) reason = chrome.runtime.lastError.message
        	console.log('Port open failed ' + reason);
        	GP_serialPortID = -1;
        	return; // failed to open port
    	}
		GP_serialPortID = connectionInfo.connectionId;
		GP_serialInputBuffers = [];
		if (!GP_serialPortListenersAdded) {
			// Listeners only need to be added once.
			chrome.serial.onReceiveError.addListener(serialPortError);
			chrome.serial.onReceive.addListener(serialPortDataReceived);
			GP_serialPortListenersAdded = true;
		}
	}
	if (!chrome.serial) return 0; // serial port API not available; do nothing
	if (GP_serialPortID >= 0) return 1; // already open (not an error)
	chrome.serial.connect(path, {persistent: true, bitrate: baud}, portOpened)
	return 1; // connect is asynchronous, but assume it will succeed
}

function GP_closeSerialPort() {
	function portClosed(ignored) { }
	if (GP_serialPortID > 0) {
		chrome.serial.disconnect(GP_serialPortID, portClosed);
	}
	GP_serialPortID = -1;
	GP_serialInputBuffers = [];
}

function GP_readSerialPort() {
	if (GP_serialPortID < 0) {
		return new Uint8Array(new ArrayBuffer(0)); // port not open
	}
	var count = 0;
	for (var i = 0; i < GP_serialInputBuffers.length; i++) {
		count += GP_serialInputBuffers[i].byteLength;
	}
	var result = new Uint8Array(new ArrayBuffer(count));
	var dst = 0;
	for (var i = 0; i < GP_serialInputBuffers.length; i++) {
		var buf = GP_serialInputBuffers[i];
		result.set(GP_serialInputBuffers[i], dst);
		dst += GP_serialInputBuffers[i].byteLength;
	}
	GP_serialInputBuffers = [];
	return result;
}

function GP_writeSerialPort(data) {
	function dataSent(ignored) { }
	if (GP_serialPortID < 0) return -1; // port not open
	chrome.serial.send(GP_serialPortID, data.buffer, dataSent);
	return data.buffer.byteLength;
}

function GP_setSerialPortDTR(flag) {
	if (GP_serialPortID < 0) return; // port not open
	chrome.serial.setControlSignals(GP_serialPortID, { dtr: flag });
}

function GP_setSerialPortRTS(flag) {
	if (GP_serialPortID < 0) return; // port not open
	chrome.serial.setControlSignals(GP_serialPortID, { rts: flag });
}

function GP_writeFile(data, fName) {
	function writeToFile(writer) { writer.write(new Blob([data], {type: 'text/plain'})); }
	function onFileSelected(entry) {
		void chrome.runtime.lastError;
		if (entry) entry.createWriter(writeToFile);
	}

	if (typeof chrome == 'undefined') { console.log('not chrome'); return; } // not running in Chrome
	chrome.fileSystem.chooseEntry(
		{type: 'saveFile', suggestedName: fName},
		onFileSelected);
}
