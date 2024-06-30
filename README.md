node-upnp-utils
===============

The node-upnp-utils is a SSDP (Simple Service Discovery Protocol) client implementation. It allows you to discover UPnP devices or services in the same subnet and to fetch device descriptions (XML) from the discovered devices.

Note that this module does *not* work well on Windows by the default Windows setting. See the section "[Running on Windows](#running-on-windows)" for detail.

## Dependencies

- [xml2js](https://www.npmjs.com/package/xml2js)

## Installation
```
$ npm install xml2js
$ npm install node-upnp-utils
```

## Table of Contents

* [Usage](#usage)
  * [Discover UPnP devices or services](#discover-upnp-devices-or-services)
  * [Discover and monitor UPnP devices or services](#discover-and-monitor-upnp-devices-or-services)
  * [Get the current active devices or services](#get-the-current-active-devices-or-services)
* [Methods](#methods)
  * [`discover()` method](#discover-method)
  * [`startDiscovery()` method](#startdiscovery-method)
  * [`stopDiscovery()` method](#stopdiscovery-method)
  * [`getActiveDeviceList()` method](#getactivedevicelist-method)
  * [`invokeAction()` method](#invokeaction-method)
  * [`wait()` method](#wait-method)
* [Events](#events)
  * [`added` event](#added-event)
  * [`deleted` event](#deleted-event)
* [The structure of discovered device](#the-structure-of-discovered-device)
* [Running on Windows](#running-on-windows)
* [Release Note](#Release-Note)
* [References](#References)
* [License](#License)

## Usage

### Discover UPnP devices or services

```JavaScript
const upnp = require('node-upnp-utils');

(async () => {
    // discover devices
    const device_list = await upnp.discover();

    for (const device of device_list) {
        console.log('------------------------------------');
        console.log(' * ' + device['address']);
        if (device['description']) {
            console.log(' * ' + device['description']['device']['manufacturer']);
            console.log(' * ' + device['description']['device']['modelName']);
        }
        console.log(' * ' + device['headers']['LOCATION']);
        console.log(' * ' + device['headers']['USN']);
    }
})();
```

The sample code above shows the discovered devices or services as follows:

```
------------------------------------
 * 192.168.11.29
 * Sony
 * BRAVIA 4K GB
 * http://192.168.11.29:8008/ssdp/device-desc.xml
 * uuid:2ea85932-fa00-ddd4-4a18-8209f8eade79::upnp:rootdevice
------------------------------------
 * 192.168.11.37
 * SHARP
 * AQUOS-4KTVJ17
 * http://192.168.11.37:8008/ssdp/device-desc.xml
 * uuid:457d6192-c077-27eb-53f6-a62b2fac68e6::upnp:rootdevice
------------------------------------
 * 192.168.11.40
 * Justin Maggard
 * Windows Media Connect compatible (MiniDLNA)
 * http://192.168.11.40:8200/rootDesc.xml
 * uuid:4d696e69-444c-164e-9d41-000c294ea6f0::upnp:rootdevice
```

### Discover and monitor UPnP devices or services

```JavaScript
const upnp = require('node-upnp-utils');

// Set an event listener for 'added' event
upnp.on('added', (device) => {
	// This callback function will be called whenever a device or a service is found.
	console.log('[added] ------------------------------------');
	console.log(' * ' + device['address']);
	if (device['description']) {
		console.log(' * ' + device['description']['device']['friendlyName']);
	}
	console.log(' * ' + device['headers']['USN']);
});

// Set an event listener for 'deleted' event
upnp.on('deleted', (device) => {
	// This callback function will be called whenever an device was deleted.
	console.log('[deleted] ------------------------------------');
	console.log(' * ' + device['address']);
	if (device['description']) {
		console.log(' * ' + device['description']['device']['friendlyName']);
	}
	console.log(' * ' + device['headers']['USN']);
});

// Start the discovery process
upnp.startDiscovery();
```

### Get the current active devices or services

```JavaScript
const upnp = require('node-upnp-utils');

(async () => {
	// Start the discovery process
	await upnp.startDiscovery();

	// Wait for 10 seconds
	await upnp.wait(10000);

	// Stop the discovery process
	await upnp.stopDiscovery();

	// Get and show the discovered devices (services)
	const device_list = upnp.getActiveDeviceList();
	for (const device of device_list) {
		console.log('------------------------------------');
		console.log(' * ' + device['address']);
		if (device['description']) {
			console.log(' * ' + device['description']['device']['manufacturer']);
			console.log(' * ' + device['description']['device']['modelName']);
		}
		console.log(' * ' + device['headers']['LOCATION']);
		console.log(' * ' + device['headers']['USN']);
	}
})();
```


---------------------------------------
## Methods

### `discover()` method

The `discover()` method sends M-SEARCH messages, then gathers information of UPnP devices or services in the same subnet, then returns a list of the discovered devices or services. This method returns a `Promise` object. In the `await` syntax, this method returns an `Array` object containing the discovered devices or services.

If this method is called during the discovery process is ongoing, an Exception will be thrown.

#### Arguments

`discover(params)`

##### *params* (optional)

This value must be an object containing the properties as follows:

Property | Type    | Required | Description
---------|---------|----------|--------
`mx`     | Integer | Optional | MX header of M-Search. This value must be an integer in the range of 1 to 120. The default value is 3 (seconds).
`st`     | String  | Optional | ST header of M-Search. The default value is `upnp:rootdevice`.
`wait`   | Integer | Optional | This method waits the M-Search responses for the specified number of seconds. The value must be in the range of 1 to 120. The default value is 5 seconds.

```javascript
const device_list = await upnp.discover({
    st: 'urn:dial-multiscreen-org:service:dial:1',
    wait: 10
});
```

### `startDiscovery()` method

The `startDiscovery()` method sends a M-SEARCH messages, then gathers information of UPnP devices or services in the same subnet. Besides, it monitors NOTIFY events until the `stopDiscovery()` method is called. This method returns a `Promise` object. In the `await` syntax, this method returns nothing.

Whenever a device or service is newly found, then this method requests the UPnP device description (XML), then emits `added` event on this instance until the `stopDiscovery()` method is called.

Whenever a `byebye` notification is received from an added device or service, this method emits `deleted` event on this instance until the `stopDiscovery()` method is called.

If this method is called during the discovery process is ongoing, an Exception will be thrown.

#### Arguments

`startDiscovery(params)`

##### *params* (optional)

This value must be an object containing the properties as follows:

Property | Required | Description
---------|----------|------------------
`mx`     | Optional | The MX header of M-Search. This value must be an integer. The default value is 3 (seconds).
`st`     | Optional | The ST header of M-Search. The default value is `upnp:rootdevice`.

```JavaScript
await upnp.startDiscovery({
  mx:3,
  st:'urn:schemas-upnp-org:service:ContentDirectory:1'
});
```

### `stopDiscovery()` method

The `stopDiscovery()` method stops the discovery process started by `startDiscovery()` method. If the discovery process is not active, this method does nothing. This method returns a `Promise` object. In the `await` syntax, this method returns nothing.

#### Arguments

`stopDiscovery(callback)`

##### *callback* (optional)
<span style="color:red;">*Note that this argument is deprecated. It will be deleted in the future.*</span>

When this method stops the discovery process, the callback will be called. No argument will be passed to the callback.

```javascript
await this.stopDiscovery();
```

### `getActiveDeviceList()` method

The `getActiveDeviceList` method returns an `Array` object representing the active devices (services) discovered by the `discover()` method or the `startDiscovery` method. 

```javascript
const device_list = this.getActiveDeviceList();
```

### `invokeAction()` method

<span style="color:red;">*Note that this method is deprecated. It will be deleted in the future.*</span>

This method sends the specified SOAP string to the specified device.

#### Arguments

`invokeAction(params, callback)`

##### *params* (required)

This value must be an object having the properties as follows:

property | required | description
:--------|:---------|:------------------
url      | required | This value is the URL of the targeted device (service).
soap     | required | This value is the SOAP string which you want to post.
action   | optional | This value is the value of the SOAPAction header. If this value was not specified, this method will search the SOAPAction value from the specified SOAP string.
cookies  | optional | This value is an array of cookies. e.x. ['key1:value1', 'key2:value2']

##### *callback* (required)

When the response (XML) from the targeted device comes, the callback will invoked.

Four arguments will be passed to the callback.

The 1st argument is an error object. It will be null if no error occurred.

The 2nd argument is an object representing the response converted from XML to JavaScript object. If xml2js module is not installed, this value will be null.

The 3rd argument is an XML string representing the response.

The 4th argument is an [http.IncomingMessage object](https://nodejs.org/api/http.html#http_class_http_incomingmessage).

### `wait()` method

The `wait()` method waits for the specified milliseconds. This method returns a `Promise` object. In the `await` syntax, this method returns nothing.

#### Arguments

`wait(msec)`

##### *msec* (required)

This value must be an integer grater than 0.


```JavaScript
await upnp.wait(1000); // Wait 1 second.
```

---------------------------------------
## Events

### `added` event

Whenever a new device or service is discovered, an `added` event is fired on the `UPnP` object. An object is passed to the callback function, which represents the device or service. See the section "The structure of discovered device" for the detail of the structre of the object.
Note that you have to invoke the `startDiscovery` method in order to listen to the event.

```javascript
upnp.on('added', (device) => {
    console.log(JSON.stringify(device, null, '    '));
});

upnp.startDiscovery();
```

### `deleted` event

Whenever this module detects any discovered device or service leave the local netwrork, an `deleted` event is fired on the `UPnP` object. An object is passed to the callback function, which represents the device or service. See the section "The structure of discovered device" for the detail of the structre of the object. Note that you have to invoke the `startDiscovery` method in order to listen to the event.

```javascript
upnp.on('deleted', (device) => {
    console.log(JSON.stringify(device, null, '    '));
});

upnp.startDiscovery();
```

---------------------------------------
## The structure of discovered device

The structure of the object representing a device or service is as follows:

```json
{
    "address": "192.168.11.40",
    "headers": {
        "$": "HTTP/1.1 200 OK",
        "CACHE-CONTROL": "max-age=130",
        "DATE": "Tue, 03 Oct 2023 10:54:46 GMT",
        "ST": "urn:schemas-upnp-org:service:ContentDirectory:1",
        "USN": "uuid:4d696e69-444c-164e-9d41-000c294ea6f0::urn:schemas-upnp-org:service:ContentDirectory:1",
        "SERVER": "Ubuntu DLNADOC/1.50 UPnP/1.0 MiniDLNA/1.3.0",
        "LOCATION": "http://192.168.11.40:8200/rootDesc.xml",
        "CONTENT-LENGTH": "0"
    },
    "expire": 1696330616771,
    "dheaders": {
        "content-type": "text/xml; charset=\"utf-8\"",
        "connection": "close",
        "content-length": "2221",
        "server": "Ubuntu DLNADOC/1.50 UPnP/1.0 MiniDLNA/1.3.0",
        "date": "Tue, 03 Oct 2023 10:54:46 GMT",
        "ext": ""
    },
    "description": {
        "$": {
            "xmlns": "urn:schemas-upnp-org:device-1-0"
        },
        "specVersion": {
            "major": "1",
            "minor": "0"
        },
        "device": {
            "deviceType": "urn:schemas-upnp-org:device:MediaServer:1",
            "friendlyName": "futomi-virtual-machine: minidlna",
            "manufacturer": "Justin Maggard",
            "manufacturerURL": "http://www.netgear.com/",
            "modelDescription": "MiniDLNA on Linux",
            "modelName": "Windows Media Connect compatible (MiniDLNA)",
            "modelNumber": "1.3.0",
            "modelURL": "http://www.netgear.com",
            "serialNumber": "00000000",
            "UDN": "uuid:4d696e69-444c-164e-9d41-000c294ea6f0",
            "dlna:X_DLNADOC": {
                "_": "DMS-1.50",
                "$": {
                    "xmlns:dlna": "urn:schemas-dlna-org:device-1-0"
                }
            },
            "presentationURL": "/",
            "iconList": {
                "icon": [
                    {
                        "mimetype": "image/png",
                        "width": "48",
                        "height": "48",
                        "depth": "24",
                        "url": "/icons/sm.png"
                    },
                    {
                        "mimetype": "image/png",
                        "width": "120",
                        "height": "120",
                        "depth": "24",
                        "url": "/icons/lrg.png"
                    },
                    {
                        "mimetype": "image/jpeg",
                        "width": "48",
                        "height": "48",
                        "depth": "24",
                        "url": "/icons/sm.jpg"
                    },
                    {
                        "mimetype": "image/jpeg",
                        "width": "120",
                        "height": "120",
                        "depth": "24",
                        "url": "/icons/lrg.jpg"
                    }
                ]
            },
            "serviceList": {
                "service": [
                    {
                        "serviceType": "urn:schemas-upnp-org:service:ContentDirectory:1",
                        "serviceId": "urn:upnp-org:serviceId:ContentDirectory",
                        "controlURL": "/ctl/ContentDir",
                        "eventSubURL": "/evt/ContentDir",
                        "SCPDURL": "/ContentDir.xml"
                    },
                    {
                        "serviceType": "urn:schemas-upnp-org:service:ConnectionManager:1",
                        "serviceId": "urn:upnp-org:serviceId:ConnectionManager",
                        "controlURL": "/ctl/ConnectionMgr",
                        "eventSubURL": "/evt/ConnectionMgr",
                        "SCPDURL": "/ConnectionMgr.xml"
                    },
                    {
                        "serviceType": "urn:microsoft.com:service:X_MS_MediaReceiverRegistrar:1",
                        "serviceId": "urn:microsoft.com:serviceId:X_MS_MediaReceiverRegistrar",
                        "controlURL": "/ctl/X_MS_MediaReceiverRegistrar",
                        "eventSubURL": "/evt/X_MS_MediaReceiverRegistrar",
                        "SCPDURL": "/X_MS_MediaReceiverRegistrar.xml"
                    }
                ]
            }
        }
    },
    "descriptionXML": "<?xml version=\"1.0\"?>..."
}
```

Properties       | Type   | Description
:----------------|:-------|:------------------------------------------
`address`        | String | IP address of the device.
`headers`        | Object | This object represents the M-SEARCH response header.
`dheaders`       | Object | This object represents the HTTP response header of the device description.
`description`    | Object | This object represents the XML description fetched from the device. The structure of this object depends on the type of device. The node-upnp-utils is agnostic on the structure of this object. If failed to fetch the XML, this property would not exist.
`descriptionXML` | String | This string is the XML itself fetched from the device. If failed to fetch the XML, this property would not exist.

---------------------------------------
## Running on Windows

This module does *not* work well on Windows by the default Windows setting.

On Windows, the "SSDP Discovery" service (SSDPSRV) is enabled by default. This service prevents the discovery process of this module. If you want to discover UPnP devices using this module, stop the "SSDP Discovery" service (SSDPSRV).

---------------------------------------
## Release Note

* v1.0.3 (2024-06-30)
    * Improved the fetch process of UPnP device descriptions.
* v1.0.2 (2024-06-29)
    * Fixed the bug that the script using this module was not terminated even though the discovery process was finished.
* v1.0.1 (2024-06-29)
    * Ignored network interfaces assigned a global IP address in the M-SEARCH process.
* v1.0.0 (2023-10-03)
    * Rewrote all codes in modern coding style using `class`, `async`, `await`, etc.
    * Supported multi-homed environment.
    * Added the `discover()` method.
    * Added the `dheaders` property in the object representing a discovered device or service.
    * Added the `wait()` method.
    * Deprecated the `invokeAction()` method.
    * Deprecated the `callback` argument of the `stopDiscovery()` method.

---------------------------------------
## <a id="References">References</a>

* [UPnP Device Architecture 2.0 - Open Connectivity Foundation](https://openconnectivity.org/developer/specifications/upnp-resources/upnp/)

---------------------------------------
## License

The MIT License (MIT)

Copyright (c) 2017 - 2024 Futomi Hatano

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
