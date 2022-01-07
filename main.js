//eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
//"use strict";
//"esversion":"6";

/*
 * ems-esp adapter version v1.0.1
 *
*/

const utils = require("@iobroker/adapter-core");
const adapterName = require('./package.json').name.split('.').pop();

const K = require("./lib/km200.js");
const E = require("./lib/ems.js");
const S = require("./lib/syslog.js");

let datafields = [];

const adapterIntervals = {};
let own_states = [];
let adapter, unloaded = false;
let db = "sql.0";

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------


function startAdapter(options) {
	options = options || {};
	Object.assign(options, {
		name: adapterName,
		unload: function (callback) {
			K.unload(true);
			E.unload(true);
			S.unload(true);
			unloaded = true;
			try {
				Object.keys(adapterIntervals).forEach(interval => adapter.log.debug("Interval cleared: " + adapterIntervals[interval]));
				Object.keys(adapterIntervals).forEach(interval => clearInterval(adapterIntervals[interval]));
				setTimeout(callback(), 1000);
				//callback();
			} catch (e) {
				callback();
			}
		},
		ready: function () {
			main();
		},
		stateChange:  (id, state) => {
			if (state && state.from !== "system.adapter."+adapter.namespace) {
				// The state was changed but not from own adapter
				adapter.getObject(id, function (err, obj) {
					// check if state was writable 
					if (obj.common.write) {
						if (obj.native.ems_km200 != null) K.state_change(id,state,obj);	
						else E.state_change(id,state,obj);						
					}
					else adapter.log.warn("state is not writable:"+id);
				});
			} 
		}
	});
	adapter = new utils.Adapter(options);
	return adapter;
}


// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
	module.exports = startAdapter;
} else {
	// or start the instance directly
	startAdapter();
}


//--------- main ---------------------------------------------------------------------------------------------------------

async function main () {

	db = adapter.config.database_instance;

	if (adapter.config.states_reorg == true) await delete_states_emsesp();
	
	if (adapter.config.syslog == true) {
		// Read own States for syslog-analysis
		try {
			for (let i = 0;i < adapter.config.devices.length;i++) {
				if (adapter.config.devices[i].state !== "" && adapter.config.devices[i].type !== "" && adapter.config.devices[i].offset !== "")
					own_states.push(adapter.config.devices[i]);
			}
		} catch(error) {}
		S.init(adapter,own_states,adapterIntervals);
	}
	

	if (adapter.config.emsesp_active && !unloaded) await E.init(adapter,own_states,adapterIntervals);
	if (adapter.config.km200_active && !unloaded)  await K.init(adapter,utils,adapterIntervals);

	if (!unloaded) await init_statistics();
	//await init_controls();

	if (!unloaded) adapter.subscribeStates("*");
	if (!unloaded &&  (adapter.config.km200_active || adapter.config.emsesp_active)) adapterIntervals.stat = setInterval(function() {read_statistics();}, 60000); // 60 sec
	if (adapter.config.eff_active && !unloaded) adapterIntervals.eff = setInterval(function() {read_efficiency();}, 60000); // 60 sec
	
}

//--------- functions ---------------------------------------------------------------------------------------------------------


function enable_state(stateid,retention,interval) {
	const id =  adapter.namespace  + "." + stateid;
	adapter.sendTo(db, "enableHistory", {id: id, options:
		{changesOnly: false,debounce: 0,retention: retention,changesRelogInterval: interval,
			maxLength: 3, changesMinDelta: 0, aliasId: "" } }, function (result) {
		if (result.error) { console.log(result.error); }
		if (result.success) {
			//adapter.setState(stateid, {ack: true, val: 0});
		}
	});
}


async function init_controls() {
	try {
	await adapter.setObjectNotExistsAsync("controls.optimize_takt",{type: "state",
		common: {type: "boolean", name: "optimization of takting time", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.use_heatingdemand",{type: "state",
		common: {type: "boolean", name: "use calculated heating demand for boiler control", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.minimum_boilerpower",{type: "state",
		common: {type: "number", name: "minimum boiler power (min modulation x boiler power)", unit: "kW", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.heatingdemand",{type: "state",
		common: {type: "number", name: "heating demand from external source", unit: "kW", role: "value", read: true, write: true}, native: {}});
	} catch(e) {}
}


async function init_statistics() {
	try {
	await adapter.setObjectNotExistsAsync("statistics.created",{type: "state",
		common: {type: "boolean", name: "Database (mySQL/InfluxDB) enabled for fields needed for statistics", unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.ems-read",{type: "state",
		common: {type: "number", name: "ems read time for polling", unit: "seconds", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.km200-read",{type: "state",
		common: {type: "number", name: "km200 read time for polling", unit: "seconds",  role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.boiler-on-1h",{type: "state",
		common: {type: "number", name: "percentage boiler on per hour", unit: "%", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.boiler-starts-1h",{type: "state",
		common: {type: "number", name: "boiler starts per hour", unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.boiler-starts-24h",{type: "state",
		common: {type: "number", name: "boiler starts per 24 hours", unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.ww-starts-1h",{type: "state",
		common: {type: "number", name: "ww starts per hour (EMS-ESP only)", unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.ww-starts-24h",{type: "state",
		common: {type: "number", name: "ww starts per 24 hours (EMS-ESP only)", unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setObjectNotExists("statistics.efficiency",{type: "state",
		common: {type: "number", name: "boiler efficiency", unit: "%", role: "value", read: true, write: true}, native: {}});
	

	adapter.getState("statistics.created", function(err, state) {
		if(state == null || state.val === false) {
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("heatSources.hs1.burnstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.burnstarts",86400,60);
			if (adapter.config.km200_active) enable_state("heatSources.numberOfStarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("dhwCircuits.dhw1.wwstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.wwstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("heatSources.hs1.burngas",86400,15);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.burngas",86400,15);
			if (adapter.config.km200_active) enable_state("heatSources.hs1.flameStatus",86400,15);
			adapter.setState("statistics.created", {ack: true, val: true});
		}
	});
	} catch(e) {}
}



async function read_efficiency() {
	if (!unloaded) {
		let value = 0, power = 0,temp = 0,tempr = 0, tempavg = 0;

		if (adapter.config.emsesp_active && adapter.config.km200_structure){
			try {
				adapter.getState("heatSources.hs1.curburnpow", function (err, state) { if (state != null) power = state.val;} );
				adapter.getState("heatSources.hs1.curflowtemp", function (err, state) {if (state != null) temp = state.val;} );
				adapter.getState("heatSources.hs1.rettemp", function (err, state) {if (state != null) tempr = state.val;} );
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}
		if (adapter.config.emsesp_active && adapter.config.km200_structure === false){
			try {
				adapter.getState("boiler.curburnpow", function (err, state) { if (state != null) power = state.val;} );
				adapter.getState("boiler.curflowtemp", function (err, state) {if (state != null) temp = state.val;} );
				adapter.getState("boiler.rettemp", function (err, state) {if (state != null) tempr = state.val;} );
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}

		if (adapter.config.emsesp_active === false && adapter.config.km200_active){
			try {
				adapter.getState("heatSources.hs1.actualModulation", function (err, state) { if (state != null) power = state.val;} );
				adapter.getState("heatSources.actualSupplyTemperature", function (err, state) {if (state != null) temp = state.val;} );
				tempr = 0;
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}

		await sleep(1000);
		
		//adapter.log.info(power+ " "+ temp + " " +tempr);
		if (power > 0) {
			if (tempr == 0) tempr = temp - 10; // when return flow temp is not available

			tempavg = (temp+tempr) / 2;
			if (tempavg <= 20) value = adapter.config.eff20;
			if (tempavg > 20) value = adapter.config.eff25;
			if (tempavg > 25) value = adapter.config.eff30;
			if (tempavg > 30) value = adapter.config.eff35;
			if (tempavg > 35) value = adapter.config.eff40;
			if (tempavg > 40) value = adapter.config.eff45;
			if (tempavg > 45) value = adapter.config.eff50;
			if (tempavg > 50) value = adapter.config.eff55;
			if (tempavg > 55) value = adapter.config.eff60;
			if (tempavg > 60) value = adapter.config.eff70;
		}
		adapter.setState("statistics.efficiency", {ack: true, val: value});
	}
}


async function read_statistics() {

	if (!unloaded) {
		let id = "";
		const end = Date.now();

		if (adapter.config.km200_active) {id = adapter.namespace + ".heatSources.numberOfStarts";}
		if (adapter.config.emsesp_active && adapter.config.km200_structure) {id = adapter.namespace + ".heatSources.hs1.burnstarts";}
		if (adapter.config.emsesp_active && adapter.config.km200_structure === false) {id = adapter.namespace + ".boiler.burnstarts";}

		stat(db,id,1,"statistics.boiler-starts-1h");
		stat(db,id,24,"statistics.boiler-starts-24h");

		if (adapter.config.emsesp_active) {
			id = adapter.namespace + ".boiler.wwstarts";
			if (adapter.config.km200_structure) id = adapter.namespace + ".dhwCircuits.dhw1.wwstarts";

			stat(db,id,1,"statistics.ww-starts-1h");
			stat(db,id,24,"statistics.ww-starts-24h");
		}


		if (adapter.config.km200_active) {id = adapter.namespace + ".heatSources.hs1.flameStatus";}
		if (adapter.config.emsesp_active && adapter.config.km200_structure ) {id = adapter.namespace + ".heatSources.hs1.burngas";}
		if (adapter.config.emsesp_active && adapter.config.km200_structure === false ) {id = adapter.namespace + ".boiler.burngas";}

		try {
		adapter.sendTo(db, "getHistory", {	id: id,	options: {start: end - 3600000, end: end, aggregate: "none"}
		}, function (result) {
			if (!unloaded) {
				const count = result.result.length;
				let on = 0;
				for (let i = 0; i < result.result.length; i++) {if (result.result[i].val == 1) on += 1;}
				let value = 0;
				if (count !== 0 && count != undefined) value = on / count * 100;
				value = Math.round(value*10)/10;
				adapter.setState("statistics.boiler-on-1h", {ack: true, val: value});
			}
		});
		} catch(e) {}
	}
}


async function stat(db,id,hour,state) {
	const end = Date.now();
	if (!unloaded) {
		try {
		adapter.sendTo(db, "getHistory", {	id: id,	options: {start: end - (hour*3600000), end: end, aggregate: "none"}
		}, function (result) {
			if (!unloaded) {
				let value = 0;
				const c = result.result.length;
				if (c == 0) value = 0;
				if (c == 1) value = 1;
				if (c > 1 && result.result[0].val == result.result[1].val) value = result.result[c-1].val-result.result[0].val;
				if (c > 1 && result.result[0].val != result.result[1].val) value = result.result[c-1].val-result.result[0].val + 1;
				adapter.setState(state, {ack: true, val: value});
			}
		});
		} catch(e) {}
	}
}



async function delete_states_emsesp() {

	const pattern = adapter.namespace + ".*";
	const states = await adapter.getStatesAsync(pattern);

	for (let id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) await adapter.delObjectAsync(id);
	}
}



async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(() => !unloaded && resolve(), ms);
    });
} 
