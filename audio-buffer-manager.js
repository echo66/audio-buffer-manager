'use strict'

function AudioBufferManager(audioContext, audioCutterUrl) {
	
	var _audioContext = audioContext;
	var _urlToBuffers = new Map();
	var _urlInfo = new Map();

	var URL_INFO_PATH = '/url_info';
	var AUDIO_CUTTER_URL = audioCutterUrl;

	this.get_url_buffers = function(url) {
		return _urlToBuffers.get(url);
	}

	this.get_audio_cutter_url = function() {
		return AUDIO_CUTTER_URL;
	}

	this.set_audio_cutter_url = function(value) {
		AUDIO_CUTTER_URL = value;
	}

	this.create_audio_buffer = function(url) {
		let p = new Promise((resolve, reject) => {
			get_url_info(url).then((info) => {
				let audioBuffer = _audioContext.createBuffer(info.numberOfChannels, info.numberOfSamples, info.sampleRate);
				audioBuffer._intervals = [];
				audioBuffer._url = url;
				audioBuffer._hasSegment = (start, duration) => {
					for (var i=0; i<audioBuffer._intervals.length; i++) {
						if (audioBuffer._intervals[i].start<=start && audioBuffer._intervals[i].end >= start+duration) {
							console.log("Segment already in memory.");
							return true;;
						}
					}
					return false;
				};
				audioBuffer._requestSegment = (start, duration) => {
					var p = new Promise((resolve, reject) => {
						let opURL = AUDIO_CUTTER_URL + '?' + 'start=' + start + '&' + 'duration=' + duration + '&' + 'url=' + audioBuffer._url;

						if (audioBuffer._hasSegment(start, duration))
							return;

						console.log("Downloading segment.");

						request_audio(opURL).then((otherAudioBuffer) => {

							// JOIN OVERLAPPING SEGMENTS
							var newInterval = {start: start, end: start+duration};
							audioBuffer._intervals[audioBuffer._intervals.length] = newInterval;
							audioBuffer._intervals.sort((a,b)=>{ return a.start-b.start; });
							var intervals = [audioBuffer._intervals[0]];
							for (var i=1; i<audioBuffer._intervals.length; i++) {
								var currInterval = intervals[intervals.length-1];
								var nextInterval = audioBuffer._intervals[i];
								if (currInterval.end < nextInterval.start) {
									intervals[intervals.length] = nextInterval;
								} else {
									currInterval.end = nextInterval.end;
								}
							}
							audioBuffer._intervals = intervals;

							// COPY THE DOWNLOADED BUFFER TO THIS AUDIO BUFFER
							let startSample = start * info.sampleRate;
							for (var c=0; c<info.numberOfChannels; c++) 
								audioBuffer.copyToChannel(otherAudioBuffer.getChannelData(c), c, startSample);

							resolve();
						}).catch(reject);
					});

					return p;
				};
				audioBuffer.getChannelData = function(channel) {
					var arr = AudioBuffer.prototype.getChannelData.apply(audioBuffer, [channel]);
					arr.subarray = function(begin, end) {
						begin = Math.max(begin, 0);
						end = Math.min(end, audioBuffer.length);

						if (begin >= end) 
							return new Float32Array(0);
						
						let start = begin / audioBuffer.sampleRate;
						let duration = (end-begin) / audioBuffer.sampleRate;
						if (!audioBuffer._hasSegment(start, duration)) {
							audioBuffer._requestSegment(start, duration);
						}

						return Float32Array.prototype.subarray.apply(arr, [begin, end]);
					}
					return arr;
				}
				resolve(audioBuffer);
			});
		});

		return p;
	}

	this.destroy = function() {
		_audioContext = null;
		_urlToBuffers.clear();
	}


	function get_url_info(url) {
		let p = new Promise((resolve, reject) => {
			if (_urlInfo.has(url)) {
				resolve(_urlInfo.get(url));
			} else {
				request(AUDIO_CUTTER_URL + URL_INFO_PATH + '?' + 'url=' + url, 'json')
					.then((info) => {
						_urlInfo.set(url, info);
						resolve(info);
					})
					.catch(() => {throw new Error("Can't obtain URL info")});
			}
		});
		return p;
	}

	function request(url, type) {
		let p = new Promise((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.open('GET', url, true);
			request.responseType = type;
			request.send();
			request.onload = () => { resolve(request.response); };
			request.onerror = () => { reject(); };
		});
		return p;
	}

	function request_audio(url, callback) {
		let p = new Promise((resolve, reject) => {
			request(url, 'arraybuffer')
				.then((response) => {
					_audioContext.decodeAudioData(response, (audioBuffer) => { resolve(audioBuffer); });
				})
				.catch(() => {throw new Error("Can't download audio.")});
		});
		return p;
	};
}