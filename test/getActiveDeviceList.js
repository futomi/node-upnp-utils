'use strict';
process.chdir(__dirname);

var upnp = require('../lib/node-upnp-utils.js');

upnp.startDiscovery();

setTimeout(() => {
	upnp.stopDiscovery(() => {
		var device_list = upnp.getActiveDeviceList();
		console.log(device_list.length + ' devices (services) were found.');
		device_list.forEach((device) => {
			var ip   = device['address'];
			var name = device['description']['device']['friendlyName'];
			console.log(' * ' + name + ' (' + ip + ')');
		});
		process.exit();
	});
}, 10000);
