/* ------------------------------------------------------------------
* node-upnp-utils - upnp-utils-dd.js
*
* Copyright (c) 2017 - 2024, Futomi Hatano, All rights reserved.
* Released under the MIT license
* Date: 2024-06-30
* ---------------------------------------------------------------- */
'use strict';
const mHttp = require('http');

let mXml2js = null;
try {
    mXml2js = require('xml2js');
} catch (e) { }

class UPnPUtilsDd {
    constructor() {
        this._req_queue = [];
        this._is_queue_running = false;
        this._caches = {};
        this._cache_expire_msec = 60000;
    }

    _wait(msec) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, msec);
        });
    }

    /* ------------------------------------------------------------------
    * fetch(url)
    *
    * This method fetches the UPnP device description from the specified URL.
    * 
    * [Arguments]
    * - url | String | Required | URL of the UPnP device description
    * 
    * [Return value]
    * - Promise object
    * - In an `await` syntax, this method returns an object representing
    *   the UPnP device description.
    * ---------------------------------------------------------------- */
    fetch(url) {
        return new Promise((resolve, reject) => {
            this._req_queue.push({
                url: url,
                success: (res) => {
                    resolve(res);
                },
                fail: (error) => {
                    reject(error);
                }
            });
            if (this._is_queue_running === false) {
                this._is_queue_running = true;
                this._runQueue();
            }
        });
    }

    async _runQueue() {
        this._expireCaches();

        if (this._req_queue.length === 0) {
            this._is_queue_running = false;
            return;
        }

        const { url, success, fail } = this._req_queue.shift();

        if (this._caches[url]) {
            if (this._caches[url].error) {
                fail(this._caches[url].error);
            } else {
                success(this._caches[url].data);
            }

        } else {
            try {
                const dd = await this._fetchXml(url);

                let obj = null;
                if (mXml2js) {
                    obj = await this._parseXml(dd.xml);
                }
                const data = { dheaders: dd.dheaders, xml: dd.xml, obj: obj };
                this._caches[url] = {
                    data: data,
                    timestamp: Date.now()
                };
                success(data);
            } catch (error) {
                this._caches[url] = {
                    error: error,
                    timestamp: Date.now()
                };
                fail(error);
            }
        }

        if (this._req_queue.length > 0) {
            this._runQueue();
        } else {
            this._is_queue_running = false;
        }
    }

    _expireCaches() {
        const url_list = Object.keys(this._caches);
        const now = Date.now();

        for (const url of url_list) {
            const cache = this._caches[url];
            if (now - cache.timestamp > this._cache_expire_msec) {
                delete this._caches[url];
            }
        }
    }

    _fetchXml(url) {
        return new Promise((resolve, reject) => {
            const timeout = 1000;
            let req = null;

            let timer = setTimeout(() => {
                req.destroy();
                reject(new Error('TIMEOUT'));
            }, timeout);

            req = mHttp.request(url, { method: 'GET' }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    const msg = `HTTP RESPONSE ERROR: url=${url}, statusCode=${res.statusCode}`;
                    reject(new Error(msg));
                    return;
                }

                res.setEncoding('utf8');
                let xml = '';

                res.on('data', (chunk) => {
                    xml += chunk;
                });

                res.on('end', () => {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    resolve({
                        xml: xml,
                        dheaders: res.headers
                    });
                });
            });

            req.on('error', (error) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                reject(error);
            });

            req.write('');
            req.end();
        });
    }

    _parseXml(xml) {
        return new Promise((resolve) => {
            const opts = { explicitRoot: false, explicitArray: false };
            mXml2js.parseString(xml, opts, (error, obj) => {
                if (error) {
                    resolve(null);
                } else {
                    resolve(obj);
                }
            });
        });
    }
}

module.exports = new UPnPUtilsDd();
