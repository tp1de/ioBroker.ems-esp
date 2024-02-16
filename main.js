/* eslint-disable no-unused-vars */
/* eslint-disable no-empty */
//eslint-disable no-empty */
//"eslint-disable no-mixed-spaces-and-tabs"
//"use strict";
//"esversion":"6";

/*
 * ems-esp adapter
 *
*/

const utils = require("@iobroker/adapter-core");
const adapterName = require("./package.json").name.split(".").pop();
const {default: axios} = require("axios");

const K = require("./lib/km200.js");
const E = require("./lib/ems.js");
const O = require("./lib/custom.js");
const S = require("./lib/syslog.js");
const F = require("./lib/functions.js");

const datafields = [];

const adapterIntervals = {};
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
			O.unload(true);
			unloaded = true;
			try {
				Object.keys(adapterIntervals).forEach(interval => adapter.log.debug("Interval cleared: " + adapterIntervals[interval]));
				Object.keys(adapterIntervals).forEach(interval => clearInterval(adapterIntervals[interval]));
				callback();
			} catch (e) {
				callback();
			}
		},
		ready: function () {
			main();
		},
		stateChange:  (id, state) => {
			if (state && !state.ack) {
				adapter.getObject(id, function (err, obj) {
					// check if state was writable
					if (obj.common.write) {
						if (obj.native.ems_km200 != null) K.state_change(id,state,obj);
						if (obj.native.ems_api == "raw")  O.state_change(id,state,obj);
						if (obj.native.ems_api != null && obj.native.ems_api != "raw" )  E.state_change(id,state,obj);
						if ( id == adapter.namespace + ".controls.active" && (state.val == false || state.val == 0)) control_reset();
					}
					else adapter.log.warn("state is not writable: "+id);
				});
			}
		}
	});
	adapter = new utils.Adapter(options);
	return adapter;
}


// If started as allInOne/compact mode => return function to create instance
// @ts-ignore
if (module && module.parent) {
	module.exports = startAdapter;
} else {
	// or start the instance directly
	startAdapter();
}


//--------- main ---------------------------------------------------------------------------------------------------------

async function main () {
	if (adapter.config.states_reorg) await delete_states_emsesp();

	await adapter.setObjectNotExistsAsync("info.connection",{type: "state",
		common: {type: "boolean", name: "connected to gateways", role: "indicator.connected", read: true, write: false, def: false}, native: {}});
	await adapter.setStateAsync("info.connection", false, true);

	await adapter.setObjectNotExistsAsync("info.connection_km200",{type: "state",
		common: {type: "boolean", name: "connected to km200 gateway", role: "indicator.connected", read: true, write: false, def: false}, native: {}});
	await adapter.setStateAsync("info.connection_km200", null, true);

	await adapter.setObjectNotExistsAsync("info.connection_ems",{type: "state",
		common: {type: "boolean", name: "connected to ems-esp gateway", role: "indicator.connected", read: true, write: false, def: false}, native: {}});
	await adapter.setStateAsync("info.connection_ems", null, true);

	db = adapter.config.database_instance;

	// Read own custom states

	if (adapter.config.db.trim() == "" ) {
		db = "";
		if (adapter.config.statistics) adapter.log.info("no database instance selected for statistics - statistics partly disabled");
	}
	else {
		db = adapter.config.db.trim()+"."+adapter.config.db_instance;

		// Test for InfluxDB V2 - Set warning

		if (adapter.config.db.trim() == "influxdb") {

			const obj = await adapter.getForeignObjectAsync("system.adapter."+db);
			//adapter.log.info(JSON.stringify(obj));
			let dbversion = "";
			try {dbversion = obj.native.dbversion;} catch(e) {}
			let retention = 0;	try {retention = obj.native.retention;} catch(e) {}
			let retdays;
			if (retention == 0) retdays = 999999;
			if (retention == -1) retdays = obj.native.customRetentionDuration;
			else retdays = retention / (24*60*60);
			let adapterversion = "";try {adapterversion = obj.common.version;} catch(e) {}
			adapter.log.info("InfluxDB "+dbversion+" - Retention: "+ retdays+" days --- Adapterversion: "+adapterversion);

			if (dbversion == "2.x" && adapterversion < "4.0.2" && adapter.config.recordings) {
				adapter.log.warn("************************************************************************************************");
				adapter.log.warn("KM200 recordings with InfluxDB require adapter version >= 4.0.2");
				adapter.log.warn("Database entries for recordings will be disabled");
				adapter.log.warn("************************************************************************************************");
			}
		}
	}

	if (!unloaded && adapter.config.statistics) await init_statistics();
	if (!unloaded) adapterIntervals.status = setInterval(function() {info();}, 10000); // 10 sec

	if (adapter.config.emsesp_active && !unloaded) await E.init(adapter,adapterIntervals);
	if (adapter.config.km200_active && !unloaded)  await K.init(adapter,utils,adapterIntervals);


	if (adapter.config.emsesp_active && adapter.config.ems_custom && !unloaded) await O.init(adapter,adapterIntervals);
	if (adapter.config.syslog && !unloaded) await S.init(adapter,utils);

	if (!unloaded) adapter.subscribeStates("*");

	if (!unloaded && adapter.config.statistics && (adapter.config.km200_active || adapter.config.emsesp_active)) {
		if (db != "") {
			await init_statistics2();
			adapterIntervals.stat = setInterval(function() {read_statistics();}, 300000); // 300 sec
		}
	}

	if (adapter.config.eff_active && !unloaded) adapterIntervals.eff = setInterval(function() {read_efficiency();}, 60000); // 60 sec

	if (adapter.config.heatdemand == 1 || adapter.config.heatdemand == true) {
		await init_controls();
		await heatdemand();
		adapter.log.info("heat demand processing: polling every minute");
		adapterIntervals.heatdemand = setInterval(function() {heatdemand();}, 60000); // 60 sec
	}


}

//--------- functions ---------------------------------------------------------------------------------------------------------

async function info() {
	try {
		const ems = (await adapter.getStateAsync("info.connection_ems")).val;
		const km200 = (await adapter.getStateAsync("info.connection_km200")).val;

		if (ems == null && km200 == true) adapter.setState("info.connection", true, true);
		if (ems == true && km200 == null) adapter.setState("info.connection", true, true);
		if (ems == true && km200 == true) adapter.setState("info.connection", true, true);
		if (ems == false || km200 == false) adapter.setState("info.connection", false, true);
	} catch(e) {}

}



async function enable_state(stateid,retention,interval) {
	const id =  adapter.namespace  + "." + stateid;
	try {
		adapter.sendTo(db, "enableHistory", {id: id, options:
			{changesOnly: true, debounce: 0,retention: retention,changesRelogInterval: interval,
				maxLength: 3, changesMinDelta: 0, aliasId: "" } }, function (result) {
			if (result.error) {adapter.log.error("enable history error " + stateid);}
		});
	} catch (e) {adapter.log.error("enable history error " + stateid );}
	await sleep (500);
	const state = await adapter.getState(stateid);
	if(state == null || state.val === undefined) await await adapter.setStateAsync(stateid, {ack: false, val: 0});
	else await await adapter.setStateAsync(stateid, {ack: true, val: state.val});
}


async function init_controls() {
	try {

		await adapter.setObjectNotExistsAsync("controls.active",{type: "state",common: {type: "boolean", name:  "heat demand control active", role: "value",
			read: true, write: true}, native: {}});

		try {const active = (await adapter.getStateAsync("controls.active")).val;}
		catch (e) {await adapter.setStateAsync("controls.active", {ack: true, val: true});}

		let value = 0;
		for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {
			const state = adapter.config.heatingcircuits[i].hc+".";
			value = parseFloat(adapter.config.heatingcircuits[i].weighton);control_state(state+"weighton","number", "hc weight for switching on", value,true);
			value = parseFloat(adapter.config.heatingcircuits[i].weightoff);control_state(state+"weightoff","number", "hc weight for switching off", value,true);
			await control_state(state+"weight","number", "hc weight actual", 99,false);
			await control_state(state+"state","string", "state for heating control", adapter.config.heatingcircuits[i].state,false);
			await control_state(state+"on","string", "state value on", adapter.config.heatingcircuits[i].on,false);
			await control_state(state+"off","string", "state value off", adapter.config.heatingcircuits[i].off,false);
			await control_state(state+"status","boolean", "hc control status",true,false);
			if(adapter.config.heatingcircuits[i].savesettemp) await control_state(state+"savesettemp","number", "saved settemp when switching off", -1,false);
		}

		for (let i = 0;i < adapter.config.thermostats.length;i++) {
			const state = adapter.config.thermostats[i].hc+"."+adapter.config.thermostats[i].room+".";
			value = 0;
			try {
				const state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].settemp);
				value = state1.val;
			} catch(e) {value = -99;}
			await control_state(state+"settemp","number", "set temperature", value,false);
			try {
				const state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].actualtemp);
				value = state1.val;
			} catch(e) {value = -99;}
			await control_state(state+"actualtemp","number", "actual temperature", value,false);
			await control_state(state+"actualweight","number", "actual weight", 0, false);

			value = parseFloat(adapter.config.thermostats[i].weight);await control_state(state+"weight","number", "room weight for switching off", value,true);
			value = parseFloat(adapter.config.thermostats[i].deltam);await control_state(state+"deltam","number", "minimum room delta temperature for switching off", value,true);

		}

	} catch(e) {}

}

async function control_state(state,type,name,value,write) {
	await adapter.setObjectAsync("controls."+state,{type: "state",
		common: {type: type, name: name, role: "value", read: true, write: write}, native: {}});
	await adapter.setStateAsync("controls."+state, {ack: true, val: value});
}


async function control_reset() {  // heat demand control switched off - reset control states for hc's

	for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {
		const hc = adapter.config.heatingcircuits[i].hc;
		const on = parseInt(adapter.config.heatingcircuits[i].on);

		adapter.log.debug("heat demand control switched off for "+ hc + " --> reset to on control value: "+on );
		await adapter.setStateAsync(adapter.config.heatingcircuits[i].state, {ack: false, val: on});
		await adapter.setStateAsync("controls."+hc+".status", {ack: true, val: true});
	}
}


async function heatdemand() {
	let w1 = 0, w2 = 0, w3 = 0, w4 = 0;

	try {if (adapter.config.thermostats.length == 0 || adapter.config.thermostats.length == undefined) return;}
	catch(e) {return;}

	for (let i = 0;i < adapter.config.thermostats.length;i++) {
		const state = "controls."+adapter.config.thermostats[i].hc+"."+adapter.config.thermostats[i].room+".";
		let settemp = 0, acttemp = 0, savetemp = 0;
		try {
			const state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].settemp);
			settemp = state1.val;
		} catch(e) {adapter.log.error(adapter.config.thermostats[i].settemp+": heat demand thermostat wrongly defined") ;return;}
		await adapter.setStateAsync(state+"settemp", {ack: true, val: settemp});

		const state2 = "controls."+adapter.config.thermostats[i].hc+".savesettemp";
		try {
			const state3 = await adapter.getStateAsync(state2);
			savetemp = state3.val;
			if (savetemp > settemp) settemp = savetemp;
		} catch(e) {}

		try {
			const state4 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].actualtemp);
			acttemp = state4.val;
		} catch(e) {adapter.log.error(adapter.config.thermostats[i].settemp+": heat demand thermostat wrongly defined") ;return;}
		await adapter.setStateAsync(state+"actualtemp", {ack: true, val: acttemp});

		//const deltam = parseFloat(adapter.config.thermostats[i].deltam);
		let deltam = 0;
		try{deltam = parseFloat((await adapter.getStateAsync(state+"deltam")).val);} catch(e) {adapter.log.error(e);}

		const delta = settemp - acttemp;

		//const weight = parseInt(adapter.config.thermostats[i].weight);
		let weight = 0;
		try {weight = (await adapter.getStateAsync(state+"weight")).val;} catch(e) {adapter.log.error(e);}

		let actualweight = 0;
		actualweight = (await adapter.getStateAsync(state+"actualweight")).val;

		if (delta >= deltam) {
			await adapter.setStateAsync(state+"actualweight", {ack: true, val: weight});
			if (adapter.config.thermostats[i].hc == "hc1") w1 += weight;
			if (adapter.config.thermostats[i].hc == "hc2") w2 += weight;
			if (adapter.config.thermostats[i].hc == "hc3") w3 += weight;
			if (adapter.config.thermostats[i].hc == "hc4") w4 += weight;
		}

		if (delta < deltam && delta >= 0 && actualweight > 0) {
			actualweight = weight;
			await adapter.setStateAsync(state+"actualweight", {ack: true, val: weight});
			if (adapter.config.thermostats[i].hc == "hc1") w1 += weight;
			if (adapter.config.thermostats[i].hc == "hc2") w2 += weight;
			if (adapter.config.thermostats[i].hc == "hc3") w3 += weight;
			if (adapter.config.thermostats[i].hc == "hc4") w4 += weight;
		}

		if (delta < 0) {
			actualweight = 0;
			await adapter.setStateAsync(state+"actualweight", {ack: true, val: 0});
		}

	}

	let hd = false;
	try {
		const active = await adapter.getStateAsync("controls.active");
		if (active.val == true || active.val == 1) hd = true;
	} catch (e) {}


	for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {
		const hc = adapter.config.heatingcircuits[i].hc;
		const state = "controls."+hc+".";

		let w = 99;
		if (hc == "hc1") w = w1;
		if (hc == "hc2") w = w2;
		if (hc == "hc3") w = w3;
		if (hc == "hc4") w = w4;

		await adapter.setStateAsync(state+"weight", {ack: true, val: w});

		if (hd == true) {

			let state5,v,weighton,weightoff,status,von,voff;

			try {
				state5 = await adapter.getForeignStateAsync(adapter.config.heatingcircuits[i].state);
				v = state5.val;
				weighton = (await adapter.getStateAsync(state+"weighton")).val;
				weightoff = (await adapter.getStateAsync(state+"weightoff")).val;
				status = (await adapter.getStateAsync(state+"status")).val;
			} catch(e) {adapter.log.error(adapter.config.heatingcircuits[i].state+": heat demand heating circuit wrongly defined") ;return; }

			try {
				von = parseInt(adapter.config.heatingcircuits[i].on);
				voff = parseInt(adapter.config.heatingcircuits[i].off);

				if (w >= weighton && v == voff) {
					await adapter.setStateAsync(state+"status", {ack: true, val: true});
					adapter.log.debug("new heat demand for "+ hc + " --> switching on" );
					await adapter.setStateAsync(adapter.config.heatingcircuits[i].state, {ack: false, val: von});

					if (adapter.config.heatingcircuits[i].savesettemp) {
						for (let ii = 0;ii < adapter.config.thermostats.length;ii++) {
							if (adapter.config.thermostats[ii].hc == hc) await adapter.setStateAsync(state+"savesettemp", {ack: true, val: 0});
						}
					}
				}

				if (w <= weightoff && v == von) {
					await adapter.setStateAsync(state+"status", {ack: true, val: false});
					adapter.log.debug("no heat demand anymore for "+ hc + " --> switching off" );
					await adapter.setStateAsync(adapter.config.heatingcircuits[i].state, {ack: false, val: voff});

					if (adapter.config.heatingcircuits[i].savesettemp) {
						for (let ii = 0;ii < adapter.config.thermostats.length;ii++) {
							if (adapter.config.thermostats[ii].hc == hc) {
								let settemp;
								try {
									const state6 = await adapter.getForeignStateAsync(adapter.config.thermostats[ii].settemp);
									settemp = state6.val;
								} catch(e) {settemp = -1;}
								await adapter.setStateAsync(state+"savesettemp", {ack: true, val: settemp});
							}
						}
					}
				}
			} catch(e) {adapter.log.warn("can not process heatdemand state: " + adapter.config.heatingcircuits[i].state);}
		}
	}
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

	} catch(e) {}
}


async function init_statistics2() {
	if (adapter.config.db.trim() == "" ) db = "";
	else db = adapter.config.db.trim()+"."+adapter.config.db_instance;

	if (db == "") {
		adapter.log.error("no database instance selected for statistics");
	}
	else {
		try {
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
}




async function read_efficiency() {
	if (!unloaded) {
		let value = 0, power = 0,temp = 0,tempr = 0, tempavg = 0,state;

		let m = adapter.config.modulation;
		let s = adapter.config.supplytemp;
		let r = adapter.config.returntemp;

		// re-initialize config parameters for previous km200 states - not to be used for ems-esp !
		if (adapter.config.emsesp_active) {
			if (m == "heatSources.hs1.actualModulation") m = "";
			if (s == "heatSources.actualSupplyTemperature") s = "";
			if (r == "heatSources.returnTemperature") r = "";
		}

		if (adapter.config.emsesp_active && adapter.config.km200_structure === false){
			if (m.trim() == "") m = "boiler.curburnpow";
			if (s.trim() == "") s = "boiler.curflowtemp";
			if (r.trim() == "") r = "boiler.rettemp";
		}

		if (adapter.config.emsesp_active && adapter.config.km200_structure){
			if (m.trim() == "") m = "heatSources.hs1.curburnpow";
			if (s.trim() == "") s = "heatSources.hs1.curflowtemp";
			if (r.trim() == "") r = "heatSources.hs1.rettemp";
		}

		if (adapter.config.emsesp_active === false && adapter.config.km200_active){
			if (m.trim() == "") m = "heatSources.hs1.actualModulation";
			if (s.trim() == "") s = "heatSources.actualSupplyTemperature";
			if (r.trim() == "") r = "heatSources.returnTemperature";
		}

		try {state = await adapter.getStateAsync(m); power = state.val;} catch(e) {power = 0;}
		if (power == 0) {try {state = await adapter.getForeignStateAsync(m); power = state.val;} catch(e) {power = 0;}}

		try {state = await adapter.getStateAsync(s); temp  = state.val;} catch(e) {temp  = 0;}
		if (temp == 0) {try {state = await adapter.getForeignStateAsync(s); temp = state.val;} catch(e) {temp = 0;}}

		try {state = await adapter.getStateAsync(r); tempr = state.val;} catch(e) {tempr = 0;}
		if (tempr == 0) {try {state = await adapter.getForeignStateAsync(r); tempr = state.val;} catch(e) {tempr = 0;}}


		if (power > 0) {
			if (tempr == 0) tempr = temp - 10; // when return flow temp is not available
			tempavg = (temp+tempr) / 2;
			if (tempavg > 60) value = adapter.config.eff70;
			else {
				if (tempavg > 55) value = adapter.config.eff60;
				else {
					if (tempavg > 50) value = adapter.config.eff55;
					else {
						if (tempavg > 45) value = adapter.config.eff50;
						else {
							if (tempavg > 40) value = adapter.config.eff45;
							else {
								if (tempavg > 35) value = adapter.config.eff40;
								else {
									if (tempavg > 30) value = adapter.config.eff35;
									else {
										if (tempavg > 25) value = adapter.config.eff30;
										else {
											if (tempavg > 20) value = adapter.config.eff25;
											else {
												if (tempavg <= 20) value = adapter.config.eff20;
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
		await adapter.setObjectNotExists("statistics.efficiency",{type: "state",
			common: {type: "number", name: "boiler efficiency", unit: "%", role: "value", read: true, write: true}, native: {}});
		await adapter.setStateAsync("statistics.efficiency", {ack: true, val: value});
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
					let count = 0;
					let on = 0;
					try {
						count = result.result.length;
						for (let i = 0; i < count; i++) {if (Math.round(result.result[i].val) == 1) on += 1;}
					} catch(e) {}

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

	if (!unloaded && id != undefined) {
		const end = Date.now();
		const intervall = hour * 3600000;

		try {
			adapter.sendTo(db, "getHistory", {	id: id,	options: {start: end - intervall, end: end, step:intervall, aggregate: "minmax"}
			}, function (result) {
				if (!unloaded) {
					let value = 0;
					let c = 0;
					try {c = result.result.length;} catch(e) {}
					if (c == 0 || c == 1) value = 0;
					try {
						if (result.result[0].val != null ) value = Math.round(result.result[c-1].val-result.result[0].val) ;
						// adapter.log.info(id + " " +hour + ": "  + Math.round(result.result[0].val)+" - " + Math.round(result.result[c-1].val) + " = " + value);
					} catch(e) {}
					adapter.setStateAsync(state, {ack: true, val: value});

				}
			});
		} catch(e) {adapter.log.error("error reading statistics records " +id);}
	}
}



async function delete_states_emsesp() {

	const pattern = adapter.namespace + ".*";
	const states = await adapter.getStatesAsync(pattern);

	for (const id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) await adapter.delObjectAsync(id);
	}
}


async function sleep(ms) {
	if (unloaded) return;
	return new Promise(resolve => {
		setTimeout(() => !unloaded && resolve(true), ms);
	});
}