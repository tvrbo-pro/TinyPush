var Promise = require('bluebird');
var gcm = require("node-gcm");
var zip = require('lodash.zip');
var gcmConnection;

var defaults = {
	appName: 'TinyPush',
	retryCount: 8,
	delayWhileIdle: false, // wait till the phone wakes from sleep
	checkPayloadSize: false, // throws an error if true and size > 2048
	simulate: false,
	concurrency: 50,
	sound: 'default'
};
var handlers = [];


function init(gcmKey, defaultValues = {}){
	if(!gcmKey) throw new Error("The provided GCM KEY is empty");

	if(defaultValues.appName)
		defaults.appName = defaultValues.appName;
	if(defaultValues.retryCount)
		defaults.retryCount = defaultValues.retryCount;
	if(defaultValues.delayWhileIdle)
		defaults.delayWhileIdle = defaultValues.delayWhileIdle;
	if(defaultValues.simulate)
		defaults.simulate = defaultValues.simulate;
	if(defaultValues.concurrency)
		defaults.concurrency = defaultValues.concurrency;
	if(defaultValues.androidSound)
		defaults.sound = defaultValues.androidSound;

	gcmConnection = new gcm.Sender(gcmKey);
}

function send(pushTokens, message, payload, sound){
	if(!gcmConnection)
		return Promise.reject(new Error("The Android notification system is not configured yet"));
	else if(!pushTokens)
		return Promise.resolve([]);
	else if(typeof pushTokens == 'object' && !pushTokens.length)
		return Promise.resolve([]);
	else if(pushTokens.length > 1000)
		return Promise.reject(new Error("The amount of recipients exceeds the maximum allowed on Android (1000)"));

	if(typeof pushTokens == 'string') {
		pushTokens = [ pushTokens ];
	}

	return new Promise((resolve, reject) => {
		var msg = {
			delayWhileIdle: defaults.delayWhileIdle,
			collapseKey: message || "(no message)", // group identical
			timeToLive: 60 * 60 * 24 * 28, // 4 weeks
			dryRun: defaults.simulate,
			notification: {
				title: defaults.appName,
				body: message,
				icon: "ic_launcher",
				sound: sound || defaults.sound
			},
			data: payload || {}
		};

		// delivery
		gcmConnection.send(new gcm.Message(msg), {registrationTokens: pushTokens}, defaults.retryCount, (err, result) => {
			if(err) return reject(err || `The android notification to ${pushTokens} did not complete`);

			// RESULT (in case of error)
			// {
			//   multicast_id: 5215101923310065000,
			//   success: 0,
			//   failure: 1,
			//   canonical_ids: 0,
			//   results: [ { error: 'NotRegistered' } ]
			// }

			resolve(result);
		});
	})
	.then(res => {
		if(!res) return;

		// regrouping like [ [resultObj1, tokenStr1], [resultObj2, tokenStr2], ... ]
		const groupedResults = zip(res.results, pushTokens);

		// map like { ...result, token: "..." }
		return groupedResults.map(tuple => Object.assign({}, tuple[0], {token: tuple[1]}) );
	})
	.then(results => {
		var tokensToUpdate = [], tokensToRemove = [];

		const {successful, failed} = results.reduce((prev, result) => {
			// puchToken cleanup
			if(result.registration_id)
				tokensToUpdate.push({from: result.token, to: result.registration_id});
			else if(result.error === 'InvalidRegistration' || result.error === 'NotRegistered')
				tokensToRemove.push(result.token);

			// count failures
			if(result.error) prev.failed++;
			else prev.successful++;

			return prev;
		}, {successful: 0, failed: 0});

		handlers.forEach(handler => {
			handler(tokensToUpdate, tokensToRemove);
		});

		return {successful, failed};
	});
}

function onFeedback(handler){
	if(typeof handler !== 'function')
		throw new Error("Not a valid function");

	handlers.push(handler);
}

module.exports = {
  init: init,
  send: send,
  onFeedback: onFeedback
};
