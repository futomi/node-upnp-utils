'use strict';
process.chdir(__dirname);

var upnp = require('../lib/node-upnp-utils.js');

upnp.on('added', (device) => {
	console.log('================================================ [added]');
	console.log(' * ' + device['headers']['$']);
	console.log(' * ' + device['address']);
	console.log(' * ' + device['description']['device']['friendlyName']);
	console.log(' * ' + device['headers']['LOCATION']);
	console.log(' * ' + device['headers']['USN']);
	console.log('');
});

upnp.on('deleted', (device) => {
	console.log('================================================== [deleted]');
	console.log(' * ' + device['headers']['$']);
	console.log(' * ' + device['address']);
	console.log(' * ' + device['description']['device']['friendlyName']);
	console.log(' * ' + device['headers']['LOCATION']);
	console.log(' * ' + device['headers']['USN']);
	console.log('');
});

upnp.on('error', (err) => {
	console.dir(err);
});

upnp.startDiscovery({mx:3, st:'upnp:urn:schemas-upnp-org:service:ContentDirectory:1'});

setTimeout(() => {
	upnp.stopDiscovery(() => {
		console.log('Stopped the discovery process.');
		process.exit();
	});
}, 60000);
