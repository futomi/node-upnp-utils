/* ------------------------------------------------------------------
* node-upnp-utils
*
* Copyright (c) 2017 - 2018, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2018-01-05
*
* [Abstract]
*
* The node-upnp-utils allows you to discover UPnP devices or services
* in the same subnet and to invole actions or queries to the targeted
* device.
*
* This module has been developed based on UPnP Device Architecture 2.0.
* You can find the specification at the web site of UPnP FORUM.
* https://openconnectivity.org/upnp/architectural-documents
*
* [Dependencies]
*  - xml2js (Optional)
*      https://www.npmjs.com/package/xml2js
*
* [Sample]
*
* - Code
*  ```
*  var upnp = require('node-upnp-utils');
*
*  upnp.on('added', (device) => {
*    console.log(device['address']);
*    console.log(device['description']['device']['friendlyName']);
*    console.log(device['headers']['LOCATION']);
*    console.log(device['headers']['USN']);
*    console.log('------------------------------------');
*  });
*
*  upnp.startDiscovery();
*
*  setTimeout(() => {
*    upnp.stopDiscovery(() => {
*      console.log('Stopped the discovery process.');
*      process.exit();
*    });
*  }, 15000);
*  ```
* ---------------------------------------------------------------- */
'use strict';
var EventEmitter = require("events").EventEmitter;
var m_util = require("util");
var m_dgram = require('dgram');
var m_http = require('http');
var m_url = require('url');
var m_xml2js = null;
try {
	m_xml2js = require('xml2js');
} catch(e) {

}

var UPnPUtils = function() {
	this.MULTICAST_ADDR = '239.255.255.250';
	this.MULTICAST_PORT = 1900;
	
	this.sockets = {
		'multicast': null,
		'unicast'  : null
	};

	this.params_default = {
		'msearch_retry': 5,
		'mx': 3,
		'st': 'upnp:rootdevice'
	};
	this.params = {
		'msearch_retry': 5,
		'mx': 3,
		'st': 'upnp:rootdevice'
	};

	this.devices = {};
	this.discovery_started = false;
	this.msearch_timer = null;
	this.check_expiration_timer = null;
	
	EventEmitter.call(this);
};
m_util.inherits(UPnPUtils, EventEmitter);

/* ------------------------------------------------------------------
* getActiveDeviceList()
*
* This method returns an array object representing the list of active
* devices (services).
*
* You can use this method after you invoke the startDiscovery()
* method.
*
* Even after you invoke the stopDiscovery(), this method returns the
* device (service) list representing the state just before the
* stopDiscovery method was invoked. That is, the list doesn't
* represent the latest state.
* 
* Before the startDiscovery() is invoked, this method will return an
* empty array.
* 
* Arguments:
*  N/A
* ---------------------------------------------------------------- */
UPnPUtils.prototype.getActiveDeviceList = function() {
	var devices = JSON.parse(JSON.stringify(this.devices));
	var list = [];
	for(var k in devices) {
		list.push(devices[k]);
	}
	return list;
};

/* ------------------------------------------------------------------
* invokeAction(params, callback)
*
* This method sends the specified SOAP string to the specified device.
*
* Arguments:
*   - params: (required)
*       This value must be an object having the members as follows:
*       - url: (required)
*          This value is the URL of the targeted device (service).
*       - sorp: (required)
*          This value is the SOAP string which you want to post.
*       - action: (optional)
*          This value is the value of the SOAPAction header.
*          If this value was not specified, this method will search 
*          the SOAPAction value from the specified SOAP string.
*       - cookies: (optional)
*          This value is an array of cookies.
*          e.x. ['key1:value;', 'key2:value;']
*  - callback: (required)
*      When the response (XML) from the targeted device comes, the
*      callback will invoked.
*      Four arguments will be passed to the callback.
*      The 1st argument is an error object. It will be null if no
*      error occurred.
*      The 2nd argument is an object representing the response
*      converdted from XML to JavaScript object. If xml2js module
*      is not installed, this value will be null.
*      The 3rd argument is an XML string representing the response.
*      The 4th argument is an http.IncomingMessage object.
*      https://nodejs.org/api/http.html#http_class_http_incomingmessage
* ---------------------------------------------------------------- */
UPnPUtils.prototype.invokeAction = function(params, callback) {
	if(!params) {
		params = {};
	}
	if(typeof(params) !== 'object') {
		throw new Error('The 1st argument must be an object.');
	}
	var url = ('url' in params) ? params['url'] : null;
	var soap = ('soap' in params) ? params['soap'] : null;
	var action = ('action' in params) ? params['action'] : null;
	var cookies = ('cookies' in params) ? params['cookies'] : null;

	if(!url) {
		throw new Error('The value of "url" is required.');
	} else if(typeof(url) !== 'string') {
		throw new Error('The value of "url" is invalid. It must be a string.');
	}

	var ourl = m_url.parse(url);
	if(!ourl || !ourl['protocol'] || !ourl['slashes'] || !ourl['host']) {
		throw new Error('The value of "url" is invalid as a URL.');
	}
	if(!soap) {
		throw new Error('The value of "soap" is required.');
	} else if(typeof(soap) !== 'string') {
		throw new Error('The value of "soap" is invalid. It must be a string.');
	}

	if(cookies) {
		if(!Array.isArray(cookies)) {
			throw new Error('The value of "cookies" is invalid. It must be an array.');
		} else if(cookies.length === 0) {
			cookies = null;
		}
	}

	if(action && typeof(action) !== 'string') {
		throw new Error('The value of "action" is invalid. It must be a string.');
	}

	if(action) {
		this._postAction(ourl, action, cookies, soap, (err, obj, xml, res) => {
			callback(err, obj, xml, res);
		});
	} else {
		this._getSoapActionFromSoapBody(soap, (soap_action) => {
			this._postAction(ourl, soap_action, cookies, soap, (err, obj, xml, res) => {
				callback(err, obj, xml, res);
			});
		});
	}
};

UPnPUtils.prototype._postAction = function(ourl, soap_action, cookies, soap, callback) {
	var post_opts = {
		protocol: ourl.protocol,
		hostname: ourl.hostname,
		port    : ourl.port || 80,
		path    : ourl.pathname,
		auth    : ourl.auth,
		method  : 'POST',
		headers : {
			'Content-Type': 'application/soap+xml'
		}
	};
	if(soap_action) {
		post_opts['headers']['SOAPAction'] = soap_action;
	}
	if(cookies) {
		post_opts['headers']['Cookie'] = cookies;
	}

	var req = m_http.request(post_opts, (res) => {
		res.setEncoding('utf8');
		var xml = '';
		res.on('data', (chunk) => {
			xml += chunk;
		});
		res.on('end', () => {
			if(m_xml2js) {
				var opt = {explicitRoot: false, explicitArray:false};
				m_xml2js.parseString(xml, opt, (err, obj) => {
					if(err) {
						callback(null, null, xml, res);
					} else {
						callback(null, obj, xml, res);
					}
				});
			} else {
				callback(null, null, xml, res);
			}
		});
	});
	req.on('error', (err) => {
		callback(err, null, null, null);
	});
	req.write(soap);
	req.end();
};

UPnPUtils.prototype._getSoapActionFromSoapBody = function(soap, callback) {
	if(!m_xml2js) {
		return callback('');
	}
	var opt = {explicitRoot: false, explicitArray:false};
	m_xml2js.parseString(soap, opt, (err, obj) => {
		if(err) {
			return callback('');
		} else {
			var sbody = obj['s:Body'];
			if(!sbody) {
				return callback('');
			}
			for(var k in sbody) {
				if(k.match(/^u\:/) && sbody[k] && sbody[k]['$'] && sbody[k]['$']['xmlns:u']) {
					var m_action = k.match(/^u\:(.+)/);
					var action = m_action[1];
					var urn = sbody[k]['$']['xmlns:u'];
					var soap_action = urn + '#' + action;
					callback(soap_action);
					break;
				}
			}
		}
	});
};

/* ============================================================================
* startDiscovery(params)
* -----------------------------------------------------------------------------
*
* [Abstract]
*
* This method sends a M-SEARCH message periodically, then gathers
* information of UPnP root devices in the same subnet.
* Besides, NOTIFY events are monitored.
* 
* If the M-SEARCH responses are received or NOTIFY message are
* received, then this method requests the UPnP description (XML)
* for each root device.
* 
* Whenever a root device is newly found, this method emits 'added'
* event on this instance until the stopDiscovery() method is called.
*
* If this method is called again during this discovery process is 
* ongoing, the call is ignored.
* 
* [Arguments]
*
*   - params: (Optional)
*       This value must be an object having the members as follows:
*       - mx:
*          This value is used for the MX header of M-Search.
*          This value must be a integer.
*          The default value is 3 (seconds).
*       - st: The value of the ST header of M-Search.
*          The default value is "upnp:rootdevice".
* -------------------------------------------------------------------------- */
UPnPUtils.prototype.startDiscovery = function(params) {
	if(this.discovery_started === true) {
		throw new Error('The startDiscovery() method can not be invoked simultaneously.');
	}

	if(!params) {
		params = {};
	}
	if(typeof(params) !== 'object') {
		throw new Error('The 1st argument must be an object.');
	}
	var mx = ('mx' in params) ? params['mx'] : this.params_default['mx'];
	var st = ('st' in params) ? params['st'] : this.params_default['st'];
	if(typeof(mx) !== 'number' || mx < 1 || mx > 120 || mx % 1 !== 0) {
		throw new Error('The value of "mx" is invalid. It must be an integer between 1 and 120.');
	}
	if(typeof(st) !== 'string') {
		throw new Error('The value of "st" is invalid. It must be string.');
	}
	this.params['mx'] = mx;
	this.params['st'] = st;

	this.devices = {};
	this.discovery_started = true;

	this._prepareMulticastUdpSocket(() => {
		this._prepareUnicastUdpSocket(() => {
			this._startMsearch(() => {
				this._startCheckExpiration();
			});
		});
	});
};

UPnPUtils.prototype._startMsearch = function(callback) {
	var num_max = this.params['msearch_retry'];
	var num = 0;
	(function send() {
		this._sendMsearch(() => {
			num ++;
			if(num < num_max) {
				this.msearch_timer = setTimeout(() => {
					send.call(this);
				}, (this.params['mx'] + 1) * 1000)
			} else {
				this.msearch_timer = null;
				callback();
			}
		});
	}.bind(this))();
};


UPnPUtils.prototype._prepareMulticastUdpSocket = function(callback) {
	this.sockets['multicast'] = m_dgram.createSocket('udp4');
	var sock = this.sockets['multicast'];

	sock.on('message', (buffer, rinfo) => {
		this._udpSocketListener(buffer, rinfo);
	});

	sock.on("error", (err) => {
		sock.close(() => {
			this.emit('error', err);
		});
	});

	sock.bind(this.MULTICAST_PORT, () => {
		sock.addMembership(this.MULTICAST_ADDR);
		callback();
	});
};

UPnPUtils.prototype._prepareUnicastUdpSocket = function(callback) {
	this.sockets['unicast'] = m_dgram.createSocket('udp4');
	var sock = this.sockets['unicast'];

	sock.on('message', (buffer, rinfo) => {
		this._udpSocketListener(buffer, rinfo);
	});

	sock.on("error", (err) => {
		sock.close(() => {
			this.emit('error', err);
		});
	});

	sock.bind(() => {
		callback();
	});
};

UPnPUtils.prototype._udpSocketListener = function(buffer, rinfo) {
	var text = buffer.toString('UTF-8');
	if(text.match(/^M\-SEARCH/)) {
		return;
	}

	var headers = this._parseSdpResponseHeader(text);
	if(!headers || !headers['USN']) {
		return;
	}

	var max_age = 1800;
	var m = null;
	if(headers['CACHE-CONTROL']) {
		m = headers['CACHE-CONTROL'].match(/max\-age\=(\d+)/);
	}
	if(m) {
		max_age = parseInt(m[1], 10);
	} else {
		max_age = 0;
	}

	var loc = headers['LOCATION'];
	var usn = headers['USN'];
	var nts = headers['NTS'];
	var nt  = headers['NT'];
	var now = Date.now();
	var expire = now + (max_age * 1000);

	if(headers['$'].match(/^HTTP\/[\d\.]+\s+200\s+OK/)) {
		if(!this.devices[usn]) {
			this.devices[usn] = {
				'address': rinfo.address,
				'headers': headers,
				'expire' : expire
			};
			this._fetchDeviceDescriptions(loc, (xml, obj) => {
				this.devices[usn]['description'] = obj;
				this.devices[usn]['descriptionXML'] = xml;
				this.emit('added', JSON.parse(JSON.stringify(this.devices[usn])));
			});
		}
	} else if(headers['$'].match(/^NOTIFY/)) {
		if(!nt) {
			return;
		}
		if(nts === 'ssdp:alive' && nt === this.params['st']) {
			if(this.devices[usn]) {
				this.devices[usn]['expire'] = expire;
			} else {
				this.devices[usn] = {
					'address': rinfo.address,
					'headers': headers,
					'expire' : expire
				};
				this._fetchDeviceDescriptions(loc, (xml, obj) => {
					this.devices[usn]['description'] = obj;
					this.devices[usn]['descriptionXML'] = xml;
					this.emit('added', JSON.parse(JSON.stringify(this.devices[usn])));
				});
			}
		} else if(nts === 'ssdp:byebye') {
			if(this.devices[usn]) {
				this.emit('deleted', JSON.parse(JSON.stringify(this.devices[usn])));
				delete this.devices[usn];
			}
		}
	}
};

UPnPUtils.prototype._sendMsearch = function(callback) {
	var ssdp_string = '';
	ssdp_string += 'M-SEARCH * HTTP/1.1\r\n';
	ssdp_string += 'HOST: ' + this.MULTICAST_ADDR + ':' + this.MULTICAST_PORT + '\r\n';
	ssdp_string += 'ST: ' + this.params['st'] + '\r\n';
	ssdp_string += 'MAN: "ssdp:discover"\r\n';
	ssdp_string += 'MX: ' + this.params['mx'] + '\r\n';
	ssdp_string += '\r\n';
	var ssdp = new Buffer(ssdp_string, 'utf8');
	var sock = this.sockets['unicast'];
	if (!sock) {
		this.emit('error', new Error('udp is null.'));
	}
	sock.send(ssdp, 0, ssdp.length, this.MULTICAST_PORT, this.MULTICAST_ADDR, (err, bytes) => {
		if(err) {
			sock.close(() => {
				this.emit('error', err);
			});
		} else {
			callback();
		}
	});
};

UPnPUtils.prototype._fetchDeviceDescriptions = function(url, callback) {
	m_http.get(url, (res) => {
		res.setEncoding('utf8');
		var xml = '';
		res.on('data', (chunk) => {
			xml += chunk;
		});
		res.on('end', () => {
			if(m_xml2js) {
				var opts = {explicitRoot: false, explicitArray:false};
				m_xml2js.parseString(xml, opts, (err, obj) => {
					callback(xml, obj);
				});
			} else {
				callback(xml, null);
			}
		});
	}).on('error', (err) => {
		this.emit('error', err);
	});
};

UPnPUtils.prototype._parseSdpResponseHeader = function(text) {
	var lines = text.split('\r\n');
	var first = lines.shift();
	if(!first.match(/^(NOTIFY|HTTP)/)) {
		return null;
	}
	var h = {};
	h['$'] = first;
	lines.forEach((ln) => {
		var m = ln.match(/^([^\:\s\t]+)[\s\t]*\:[\s\t]*(.+)/);
		if(m) {
			var k = m[1].toUpperCase();
			h[k] = m[2];
		}
	});
	return h;
};

UPnPUtils.prototype._startCheckExpiration = function() {
	this._checkExpiration();
	this.check_expiration_timer = setTimeout(() => {
		this._startCheckExpiration();
	}, 1000);
};

UPnPUtils.prototype._stopCheckExpiration = function() {
	if(this.check_expiration_timer !== null) {
		clearTimeout(this.check_expiration_timer);
		this.check_expiration_timer = null;
	}
};

UPnPUtils.prototype._checkExpiration = function() {
	var now = Date.now();
	for(var k in this.devices) {
		if(this.devices[k]['expire'] < now) {
			var device = JSON.parse(JSON.stringify(this.devices[k]));
			delete this.devices[k];
			this.emit('deleted', device);
		}
	}
};

/* ============================================================================
* stopDiscovery(callback)
* -----------------------------------------------------------------------------
*
* [Abstract]
*
* This method stops the discovery process started by startDiscovery() method.
* If the discovery process is not active, this method does nothing.
*
* [Arguments]
*
* - callback
*    When this method finishes to stop the discovery process, the callback
*    will called. No argument will be passed to the callback.
* -------------------------------------------------------------------------- */
UPnPUtils.prototype.stopDiscovery = function(callback) {
	if(!callback) {
		callback = function() {};
	}
	if(this.discovery_started === true) {
		if(this.msearch_timer !== null) {
			clearTimeout(this.msearch_timer);
		}
		this._stopCheckExpiration();
		this.sockets['multicast'].close(() => {
			this.sockets['unicast'].close(() => {
				this.sockets['multicast'] = null;
				this.sockets['unicast'] = null;
				this.discovery_started = false;
				callback();
			});
		});
	} else {
		this.discovery_started = false;
		callback();
	}
};

module.exports = new UPnPUtils();
