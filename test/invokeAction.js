'use strict';
process.chdir(__dirname);

var upnp = require('../lib/node-upnp-utils.js');

var soap = '';
soap += '<?xml version="1.0" encoding="utf-8"?>';
soap += '<s:Envelope';
soap += '  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"';
soap += '  xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">';
soap += '  <s:Body>';
soap += '    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">';
soap += '      <ObjectID>0</ObjectID>';
soap += '      <BrowseFlag>BrowseDirectChildren</BrowseFlag>';
soap += '      <Filter>*</Filter>';
soap += '      <StartingIndex>0</StartingIndex>';
soap += '      <RequestedCount>100000</RequestedCount>';
soap += '      <SortCriteria></SortCriteria>';
soap += '    </u:Browse>';
soap += '  </s:Body>';
soap += '</s:Envelope>';

var params = {
	'url': 'http://192.168.10.4:20003/MediaServer/ContentDirectory/Control',
	'soap': soap
};

upnp.invokeAction(params, (err, obj, xml, res) => {
	if(err) {
		console.log('[ERROR]');
		console.dir(err);
	} else {	
		if(res['statusCode'] === 200) {
			console.log('[SUCCESS]');
		} else {
			console.log('[ERROR]');
		}
		console.log('----------------------------------');
		console.log(JSON.stringify(obj, null, '  '))
	}
});