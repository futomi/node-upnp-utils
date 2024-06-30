/* ------------------------------------------------------------------
* node-upnp-utils
*
* Copyright (c) 2017 - 2023, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2024-06-29
* ---------------------------------------------------------------- */
'use strict';
const mEventEmitter = require('events');
const mDgram = require('dgram');
const mHttp = require('http');
const mUrl = require('url');
const mOs = require('os');
const mUpnpUtilsDd = require('./upnp-utils-dd.js');

let mXml2js = null;
try {
    mXml2js = require('xml2js');
} catch (e) { }

class UPnPUtils extends mEventEmitter {
    constructor() {
        super();

        this._MULTICAST_ADDR = '239.255.255.250';
        this._SSDP_PORT = 1900;

        this._netif_address_list = [];
        this._udp = null;

        this._devices = {};
        this._is_discovering = false;
        this._expiration_check_timer = null;
        this._params = {};

    }

    /* -----------------------------------------------------------------------------
    * wait(msec)
    *
    * The `wait` method waits for the specified milliseconds.
    * This method returns a Promise object.
    * This method takes an argument as follows:
    * 
    * [Arguments]
    * - msec | Integer | Required | milliseconds
    * -------------------------------------------------------------------------- */
    wait(msec) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, msec);
        });
    }

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
    * necessarily represent the latest state.
    * 
    * Before the startDiscovery() is invoked, this method will return an
    * empty array.
    * 
    * [Arguments]
    * - None
    * ---------------------------------------------------------------- */
    getActiveDeviceList() {
        const devices = JSON.parse(JSON.stringify(this._devices));
        const list = [];
        for (const device of Object.values(devices)) {
            list.push(device);
        }
        return list;
    }

    /* -----------------------------------------------------------------------------
    * discover(params)
    *
    * This method sends a M-SEARCH message, then gathers information of UPnP devices,
    * then return the list of the discovered devices.
    * 
    * [Arguments]
    * - params | Object  | Optional |
    *   - mx   | Integer | Optional | MX header of M-Search.
    *          |         |          | This value must be an integer in the range of 1 to 120.
    *          |         |          | The default value is 3 (seconds).
    *   - st   | String  | Optional | ST header of M-Search.
    *          |         |          | The default value is "upnp:rootdevice".
    *   - wait | Integer | Optional | This method waits the M-Search responses
    *          |         |          | for the specified number of seconds.
    *          |         |          | The value must be in the range of 1 to 120.
    *          |         |          | The default value is 5 seconds.
    * 
    * [Return value]
    * - Promise object
    * -  
    * -------------------------------------------------------------------------- */
    async discover(params = {}) {
        if (this._is_discovering === true) {
            throw new Error('The discovery process is running.');
        }

        // Check the `wait` parameter
        const sec = params.wait || 5;
        if (typeof (sec) !== 'number' || sec % 1 !== 0 || sec < 1 || sec > 120) {
            throw new Error('The `wait` must be an itenger in the range of 1 to 120.');
        }

        // Start the discovery process
        await this.startDiscovery(params);
        await this.wait(sec * 1000);
        await this.stopDiscovery();

        // Get the discovered devices
        const device_list = this.getActiveDeviceList();
        return device_list;
    }

    /* -----------------------------------------------------------------------------
    * startDiscovery(params)
    *
    * This method sends a M-SEARCH message periodically, then gathers information
    * of UPnP root devices in the same subnet.
    * Besides, NOTIFY events are monitored.
    * 
    * If the M-SEARCH responses are received or NOTIFY message are received,
    * then this method requests the UPnP description (XML) for each root device.
    * 
    * Whenever a root device is newly found, this method emits 'added' event
    * on this instance until the stopDiscovery() method is called.
    *
    * If this method is called again during this discovery process is ongoing,
    * the call is ignored.
    * 
    * [Arguments]
    *
    * - params | Object  | Optional |
    *   - mx   | Integer | Optional | MX header of M-Search.
    *          |         |          | This value must be an integer in the range of 1 to 120.
    *          |         |          | The default value is 3 (seconds).
    *   - st   | String  | Optional | ST header of M-Search.
    *          |         |          | The default value is "upnp:rootdevice".
    * -------------------------------------------------------------------------- */
    async startDiscovery(params = {}) {
        if (this._is_discovering === true) {
            throw new Error('The startDiscovery() method can not be invoked simultaneously.');
        }

        // Check the parameters
        this._params = this._checkMSearchParams(params);

        // Update the list of network interface IP address
        this._netif_address_list = this._getNetifAddressList();

        this._devices = {};
        this._is_discovering = true;

        try {
            await this._startListening();
            await this._startMsearch();
        } catch (error) {
            throw error;
        }
        this._startExpirationCheck();
    }

    _checkMSearchParams(params = {}) {
        if (typeof (params) !== 'object') {
            throw new Error('The 1st argument must be an object.');
        }
        const mx = ('mx' in params) ? params['mx'] : 3;
        const st = ('st' in params) ? params['st'] : 'upnp:rootdevice';
        if (typeof (mx) !== 'number' || mx < 1 || mx > 120 || mx % 1 !== 0) {
            throw new Error('The value of "mx" is invalid. It must be an integer between 1 and 120.');
        }
        if (typeof (st) !== 'string') {
            throw new Error('The value of "st" is invalid. It must be string.');
        }
        return { mx: mx, st: st };
    }

    _startListening() {
        return new Promise((resolve, reject) => {
            // Set up a UDP tranceiver
            this._udp = mDgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            });

            this._udp.once('error', (error) => {
                reject(error);
                return;
            });

            this._udp.once('listening', () => {
                this._addMembership();
                setTimeout(() => {
                    resolve();
                }, 100);
            });

            this._udp.on('message', (buf, rinfo) => {
                this._receivePacket(buf, rinfo);
            });

            this._udp.bind({ port: this._SSDP_PORT }, () => {
                this._udp.removeAllListeners('error');
            });
        });
    }

    _addMembership() {
        for (const netif_address of this._netif_address_list) {
            try {
                this._udp.addMembership(this._MULTICAST_ADDR, netif_address);
            } catch (e) {
                console.log(`Catching error on address already in use: ${JSON.stringify(e)}`);
            }
        }
    }

    _dropMembership() {
        for (const netif_address of this._netif_address_list) {
            try {
                this._udp.dropMembership(this._MULTICAST_ADDR, netif_address);
            } catch (e) {
                console.log(`Catching error on dropMembership: ${JSON.stringify(e)}`);
            }
        }
    }

    _getNetifAddressList() {
        const list = [];
        const netifs = mOs.networkInterfaces();
        for (const iflist of Object.values(netifs)) {
            for (const info of iflist) {
                // Exclude a loopback address
                if (info.internal) {
                    continue;
                }
                // Exclude a non-IPv4 address
                if (info.family !== 'IPv4') {
                    continue;
                }
                // Exclude a link-local address
                if (/^169\.254\./.test(info.address)) {
                    continue;
                }

                // Exclude a global address
                if (!this._isPrivateAddress(info.address)) {
                    continue;
                }

                list.push(info.address);
            }
        }
        return list;
    }

    _isPrivateAddress(addr) {
        const cidr_list = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
        let included = false;
        for (let i = 0, len = cidr_list.length; i < len; i++) {
            if (this._isAddressInCidr(addr, cidr_list[i])) {
                included = true;
                break;
            }
        }
        return included;
    }

    _isAddressInCidr(addr, cidr) {
        let [netaddr, mask] = cidr.split('/');
        mask = parseInt(mask, 10);
        let host_bit_num = 32 - parseInt(mask, 10);

        let netaddr_buf = this._getAddressBuffer(netaddr);
        let netaddr_n = netaddr_buf.readUInt32BE(0) >>> host_bit_num;

        let addr_buf = this._getAddressBuffer(addr);
        let addr_n = addr_buf.readUInt32BE(0) >>> host_bit_num;

        return (netaddr_n === addr_n) ? true : false;
    }

    _getAddressBuffer(addr) {
        let buf = Buffer.alloc(4);
        addr.split('.').forEach((n, i) => {
            buf.writeUInt8(parseInt(n, 10), i);
        });
        return buf;
    }

    async _startMsearch() {
        let ssdp_string = '';
        ssdp_string += 'M-SEARCH * HTTP/1.1\r\n';
        ssdp_string += 'HOST: ' + this._MULTICAST_ADDR + ':' + this._SSDP_PORT + '\r\n';
        ssdp_string += 'ST: ' + this._params['st'] + '\r\n';
        ssdp_string += 'MAN: "ssdp:discover"\r\n';
        ssdp_string += 'MX: ' + this._params['mx'] + '\r\n';
        ssdp_string += '\r\n';
        const buf = Buffer.from(ssdp_string, 'utf8');

        for (const netif_address of this._netif_address_list) {
            this._udp.setMulticastInterface(netif_address);
            await this.wait(200);
            for (let i = 0; i < 3; i++) {
                await this._udpSend(buf, this._SSDP_PORT, this._MULTICAST_ADDR);
                await this.wait(100);
            }
        }
    }

    _udpSend(buf, port, addr) {
        return new Promise((resolve, reject) => {
            this._udp.send(buf, 0, buf.length, port, addr, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async _receivePacket(buffer, rinfo) {
        const text = buffer.toString('utf8');
        if (text.match(/^M\-SEARCH/)) {
            return;
        }

        const headers = this._parseSdpResponseHeader(text);
        if (!headers || !headers['USN']) {
            return;
        }

        let max_age = 1800;
        let m = null;
        if (headers['CACHE-CONTROL']) {
            m = headers['CACHE-CONTROL'].match(/max\-age\=(\d+)/);
        }
        if (m) {
            max_age = parseInt(m[1], 10);
        }

        const loc = headers['LOCATION'];
        const usn = headers['USN'];
        const nts = headers['NTS'];
        const nt = headers['NT'];
        const now = Date.now();
        const expire = now + (max_age * 1000);

        if (headers['$'].match(/^HTTP\/[\d\.]+\s+200\s+OK/)) {
            if (!this._devices[usn]) {
                this._devices[usn] = {
                    address: rinfo.address,
                    headers: headers,
                    expire: expire
                };

                const ourl = new URL(loc);
                if (ourl.hostname === rinfo.address) {
                    try {
                        const { dheaders, xml, obj } = await mUpnpUtilsDd.fetch(loc);
                        this._devices[usn]['dheaders'] = dheaders;
                        this._devices[usn]['description'] = obj;
                        this._devices[usn]['descriptionXML'] = xml;
                    } catch (error) {
                        //const msg = 'HTTP_ERROR: url=' + loc + ', message=' + error.message;
                        //this.emit('error', new Error(msg));
                    }
                }
                this.emit('added', JSON.parse(JSON.stringify(this._devices[usn])));
            }
        } else if (headers['$'].match(/^NOTIFY/)) {
            if (!nt) {
                return;
            }
            if (nts === 'ssdp:alive' && nt === this._params['st']) {
                if (this._devices[usn]) {
                    this._devices[usn]['expire'] = expire;
                } else {
                    this._devices[usn] = {
                        address: rinfo.address,
                        headers: headers,
                        expire: expire
                    };
                    try {
                        const { dheaders, xml, obj } = await mUpnpUtilsDd.fetch(loc);
                        this._devices[usn]['dheaders'] = dheaders;
                        this._devices[usn]['description'] = obj;
                        this._devices[usn]['descriptionXML'] = xml;
                    } catch (error) {
                        //const msg = 'HTTP_ERROR: url=' + loc + ', message=' + error.message;
                        //this.emit('error', new Error(msg));
                    }
                    this.emit('added', JSON.parse(JSON.stringify(this._devices[usn])));
                }
            } else if (nts === 'ssdp:byebye') {
                if (this._devices[usn]) {
                    this.emit('deleted', JSON.parse(JSON.stringify(this._devices[usn])));
                    delete this._devices[usn];
                }
            }
        }
    }

    _parseSdpResponseHeader(text) {
        const lines = text.split('\r\n');
        const first = lines.shift();
        if (!first.match(/^(NOTIFY|HTTP)/)) {
            return null;
        }
        const h = {};
        h['$'] = first;
        lines.forEach((ln) => {
            const m = ln.match(/^([^\:\s\t]+)[\s\t]*\:[\s\t]*(.+)/);
            if (m) {
                const k = m[1].toUpperCase();
                h[k] = m[2];
            }
        });
        return h;
    }

    _startExpirationCheck() {
        const now = Date.now();
        for (const id of Object.keys(this._devices)) {
            const device = this._devices[id];
            if (device['expire'] < now) {
                const dev = JSON.parse(JSON.stringify(device));
                delete this._devices[id];
                this.emit('deleted', dev);
            }
        }
        this._expiration_check_timer = setTimeout(() => {
            this._startExpirationCheck();
        }, 1000);
    }

    _stopExpirationCheck() {
        if (this._expiration_check_timer !== null) {
            clearTimeout(this._expiration_check_timer);
            this._expiration_check_timer = null;
        }
    }

    /* -----------------------------------------------------------------------------
    * stopDiscovery(callback)
    *
    * This method stops the discovery process started by startDiscovery() method.
    * If the discovery process is not active, this method does nothing.
    *
    * [Arguments]
    *
    * - callback | Function | Optional | When this method finishes to stop the discovery process,
    *            |          |          | the callback will called. No argument will be passed to
    *            |          |          | the callback.
    * 
    * [WARNING] The callback style is deprecated. The async/await style should be used.
    * -------------------------------------------------------------------------- */
    async stopDiscovery(callback) {
        if (!callback) {
            callback = () => { };
        }
        try {
            await this._stopListening();
        } catch (error) {
            // Do nothing
        }
        this._is_discovering = false;
        callback();
    }

    _stopListening() {
        return new Promise((resolve) => {
            this._dropMembership();
            this._stopExpirationCheck();

            if (this._udp) {
                this._udp.removeAllListeners('message');
                this._udp.removeAllListeners('error');
                this._udp.removeAllListeners('listening');
                this._udp.close(() => {
                    this._udp.unref();
                    this._udp = null;
                    resolve();
                });
            } else {
                resolve();
            }

        });
    }

    /* ------------------------------------------------------------------
    * invokeAction(params, callback)
    * !!!!! [WARNING] This method is deprecated. !!!!!
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
    invokeAction(params, callback) {
        if (!params) {
            params = {};
        }
        if (typeof (params) !== 'object') {
            throw new Error('The 1st argument must be an object.');
        }
        const url = ('url' in params) ? params['url'] : null;
        const soap = ('soap' in params) ? params['soap'] : null;
        const action = ('action' in params) ? params['action'] : null;
        const cookies = ('cookies' in params) ? params['cookies'] : null;

        if (!url) {
            throw new Error('The value of "url" is required.');
        } else if (typeof (url) !== 'string') {
            throw new Error('The value of "url" is invalid. It must be a string.');
        }

        const ourl = mUrl.parse(url);
        if (!ourl || !ourl['protocol'] || !ourl['slashes'] || !ourl['host']) {
            throw new Error('The value of "url" is invalid as a URL.');
        }
        if (!soap) {
            throw new Error('The value of "soap" is required.');
        } else if (typeof (soap) !== 'string') {
            throw new Error('The value of "soap" is invalid. It must be a string.');
        }

        if (cookies) {
            if (!Array.isArray(cookies)) {
                throw new Error('The value of "cookies" is invalid. It must be an array.');
            } else if (cookies.length === 0) {
                cookies = null;
            }
        }

        if (action && typeof (action) !== 'string') {
            throw new Error('The value of "action" is invalid. It must be a string.');
        }

        if (action) {
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
    }

    _postAction(ourl, soap_action, cookies, soap, callback) {
        const post_opts = {
            protocol: ourl.protocol,
            hostname: ourl.hostname,
            port: ourl.port || 80,
            path: ourl.pathname,
            auth: ourl.auth,
            method: 'POST',
            headers: {
                'Content-Type': 'application/soap+xml'
            }
        };
        if (soap_action) {
            post_opts['headers']['SOAPAction'] = soap_action;
        }
        if (cookies) {
            post_opts['headers']['Cookie'] = cookies;
        }

        const req = mHttp.request(post_opts, (res) => {
            res.setEncoding('utf8');
            let xml = '';
            res.on('data', (chunk) => {
                xml += chunk;
            });
            res.on('end', () => {
                if (mXml2js) {
                    const opt = { explicitRoot: false, explicitArray: false };
                    mXml2js.parseString(xml, opt, (err, obj) => {
                        if (err) {
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
    }

    _getSoapActionFromSoapBody(soap, callback) {
        if (!mXml2js) {
            return callback('');
        }
        const opt = { explicitRoot: false, explicitArray: false };
        mXml2js.parseString(soap, opt, (err, obj) => {
            if (err) {
                return callback('');
            } else {
                const sbody = obj['s:Body'];
                if (!sbody) {
                    return callback('');
                }
                for (let k in sbody) {
                    if (k.match(/^u\:/) && sbody[k] && sbody[k]['$'] && sbody[k]['$']['xmlns:u']) {
                        const m_action = k.match(/^u\:(.+)/);
                        const action = m_action[1];
                        const urn = sbody[k]['$']['xmlns:u'];
                        const soap_action = urn + '#' + action;
                        callback(soap_action);
                        break;
                    }
                }
            }
        });
    }

}

module.exports = new UPnPUtils();
