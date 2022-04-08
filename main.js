//eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
//"use strict";
//"esversion":"6";

/*
 * ems-esp adapter
 *
*/

const utils = require("@iobroker/adapter-core");
const adapterName = require("./package.json").name.split(".").pop();

const K = require("./lib/km200.js");
const E = require("./lib/ems.js");
const S = require("./lib/syslog.js");

const datafields = [];

const adapterIntervals = {};
const own_states = [];
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
			if (adapter.config.syslog) S.unload(true);
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
						if (obj.native.ems_api == "raw") S.state_change(id,state,obj);
						if (obj.native.ems_api == "V3" || obj.native.ems_api == "V2" ) E.state_change(id,state,obj);
						if ( id == adapter.namespace + ".controls.active" && !state.val) control_reset();
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
		// Read own states for syslog-analysis
		try {
			for (let i = 0;i < adapter.config.devices.length;i++) {
				if (adapter.config.devices[i].state !== "" && adapter.config.devices[i].type !== "" && adapter.config.devices[i].offset !== "")
					own_states.push(adapter.config.devices[i]);
			}
		} catch(error) {}
		S.init(adapter,own_states,adapterIntervals);
	}


	if (!unloaded && adapter.config.statistics) await init_statistics();
	if (adapter.config.emsesp_active && !unloaded) await E.init(adapter,own_states,adapterIntervals);
	if (adapter.config.km200_active && !unloaded)  await K.init(adapter,utils,adapterIntervals);

	if (!unloaded) adapter.subscribeStates("*");

	if (!unloaded && adapter.config.statistics && (adapter.config.km200_active || adapter.config.emsesp_active)) {
		adapterIntervals.stat = setInterval(function() {init_statistics2();read_statistics();}, 60000); // 60 sec
	}
	if (adapter.config.eff_active && !unloaded) adapterIntervals.eff = setInterval(function() {read_efficiency();}, 60000); // 60 sec

	if (adapter.config.heatdemand && !unloaded) {
		await init_controls();
		await heatdemand();
		adapterIntervals.heatdemand = setInterval(function() {heatdemand();}, 60000); // 60 sec
	}

}

//--------- functions ---------------------------------------------------------------------------------------------------------


function enable_state(stateid,retention,interval) {
	const id =  adapter.namespace  + "." + stateid;
	adapter.sendTo(db, "enableHistory", {id: id, options:
		{changesOnly: false,debounce: 0,retention: retention,changesRelogInterval: interval,
			maxLength: 3, changesMinDelta: 0, aliasId: "" } }, function (result) {
		if (result.error) {adapter.log.error("enable history error " + stateid);}
		if (result.success) {
			//adapter.setState(stateid, {ack: true, val: 0});
		}
	});
}


async function init_controls() {
	try {

		for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {			
			let state = adapter.config.heatingcircuits[i].hc+".";
			control_state(state+"weighton","number", "hc weight for switching on", parseFloat(adapter.config.heatingcircuits[i].weighton));
			control_state(state+"weightoff","number", "hc weight for switching off", parseFloat(adapter.config.heatingcircuits[i].weightoff));
			control_state(state+"weight","number", "hc weight actual", 99);
			control_state(state+"state","string", "state for heating control", adapter.config.heatingcircuits[i].state);
			control_state(state+"on","string", "state value on", adapter.config.heatingcircuits[i].on);
			control_state(state+"off","string", "state value off", adapter.config.heatingcircuits[i].off);
			control_state(state+"status","boolean", "hc control status", true);
			if(adapter.config.heatingcircuits[i].savesettemp) control_state(state+"savesettemp","number", "saved settemp when switching off", -99);
			control_state("active","boolean", "hc control active", true);
		}
	} catch(e) {}

	for (let i = 0;i < adapter.config.thermostats.length;i++) {	
		let state = adapter.config.thermostats[i].hc+"."+adapter.config.thermostats[i].room+".";
		let value = 0;
		try {
			let state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].settemp);	
			value = state1.val;
		} catch(e) {value = -99;}	
		control_state(state+"settemp","number", "set temperature", value);
		try {
			state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].actualtemp);
			value = state1.val;
		} catch(e) {value = -99;}
		control_state(state+"actualtemp","number", "actual temperature", value);
		
		control_state(state+"weight","number", "room weight for switching off", parseFloat(adapter.config.thermostats[i].weight));
		control_state(state+"deltam","number", "minimum room delta temperature for switching off", parseFloat(adapter.config.thermostats[i].deltam));

	}
	
}

async function control_state(state,type,name,value) {
	await adapter.setObjectNotExistsAsync("controls."+state,{type: "state",
	common: {type: type, name: name, unit: "", role: "value", read: true, write: true}, native: {}});
	adapter.setState("controls."+state, {ack: true, val: value});
}


async function control_reset() {  // heat demand control switched off - reset control states for hc's

	for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {	
		let hc = adapter.config.heatingcircuits[i].hc;
		if (adapter.config.heatingcircuits[i].savesettemp) {
			let state = "controls."+hc+".savesettemp";
			let savetemp = 0;
			try {
				let state1 = await adapter.getStateAsync(state);
				savetemp = state1.val;
			} catch(e) {}
			if (savetemp != 0) {
				adapter.log.info("heat demand control switched off for "+ hc + " --> reset old control value: "+savetemp );
				adapter.setState(adapter.config.heatingcircuits[i].state, {ack: false, val: savetemp});
			}
		} else {
			let on = parseInt(adapter.config.heatingcircuits[i].on);
			adapter.log.info("heat demand control switched off for "+ hc + " --> reset to on control value: "+on );
			adapter.setState(adapter.config.heatingcircuits[i].state, {ack: false, val: on});
		}
	}
}

async function heatdemand() {
	let w1 = 0, w2 = 0, w3 = 0, w4 = 0;
	let active = await adapter.getStateAsync("controls.active");
	if (!active.val) {
		
		return;
	}

	for (let i = 0;i < adapter.config.thermostats.length;i++) {	
		let state = "controls."+adapter.config.thermostats[i].hc+"."+adapter.config.thermostats[i].room+".";
		let value1 = 0, value2 = 0;
		try {
			let state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].settemp);
			value1 = state1.val;
		} catch(e) {value1 = -99;}	
		adapter.setState(state+"settemp", {ack: true, val: value1});

		let state2 = "controls."+adapter.config.thermostats[i].hc+".savesettemp";
		try {
			let state1 = await adapter.getStateAsync(state2);
			if (state1.val > value1) value1 = state1.val;
		} catch(e) {}

		try {
			state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[i].actualtemp);
			value2 = state1.val;
		} catch(e) {value2 = -99;}
		adapter.setState(state+"actualtemp", {ack: true, val: value2});

		if ((value1 - value2) > parseFloat(adapter.config.thermostats[i].deltam)) {
			if (adapter.config.thermostats[i].hc == "hc1") w1 += parseInt(adapter.config.thermostats[i].weight);
			if (adapter.config.thermostats[i].hc == "hc2") w2 += parseInt(adapter.config.thermostats[i].weight);
			if (adapter.config.thermostats[i].hc == "hc3") w3 += parseInt(adapter.config.thermostats[i].weight);
			if (adapter.config.thermostats[i].hc == "hc4") w4 += parseInt(adapter.config.thermostats[i].weight);
		}
	}

	for (let i = 0;i < adapter.config.heatingcircuits.length;i++) {	
		let hc = adapter.config.heatingcircuits[i].hc;
		let state = "controls."+hc+".";
		let value3;
		try {
			let state1 = await adapter.getForeignStateAsync(adapter.config.heatingcircuits[i].state);	
			value3 = state1.val;
		} catch(e) {value3 = "";}	

		let w = 99;
		if (hc == "hc1") w = w1;
		if (hc == "hc2") w = w2;
		if (hc == "hc3") w = w3;
		if (hc == "hc4") w = w4;
		adapter.setState(state+"weight", {ack: true, val: w});

		if (w >= adapter.config.heatingcircuits[i].weighton) {
			adapter.setState(state+"status", {ack: true, val: true});
			let state2 = await adapter.getForeignStateAsync(adapter.config.heatingcircuits[i].state);
			let v = state2.val;
			let vn = parseInt(adapter.config.heatingcircuits[i].on);
			if (v != vn) {
				let vo = parseInt(adapter.config.heatingcircuits[i].off);
				if (v == vo) {
					adapter.log.info("new heat demand for "+ hc + " --> switching on" );
					adapter.setState(adapter.config.heatingcircuits[i].state, {ack: false, val: vn});
					if (adapter.config.heatingcircuits[i].savesettemp) {
						for (let ii = 0;ii < adapter.config.thermostats.length;ii++) {	
							if (adapter.config.thermostats[ii].hc == hc) adapter.setState(state+"savesettemp", {ack: true, val: 0});
						}
					}
				} else {
					//adapter.log.info("heat demand manually set for "+ hc + " --> no action");
				}
			}
		}

		if (w <= adapter.config.heatingcircuits[i].weightoff) {
			adapter.setState(state+"status", {ack: true, val: false});
			let state2 = await adapter.getForeignStateAsync(adapter.config.heatingcircuits[i].state);
			let v = state2.val;
			let vn = parseInt(adapter.config.heatingcircuits[i].off);
			if (v != vn) {
				let vo = parseInt(adapter.config.heatingcircuits[i].on);
				if (v == vo ||adapter.config.heatingcircuits[i].override) {

					if (adapter.config.heatingcircuits[i].savesettemp) {
						for (let ii = 0;ii < adapter.config.thermostats.length;ii++) {	
							if (adapter.config.thermostats[ii].hc == hc) {
								try {
									let state1 = await adapter.getForeignStateAsync(adapter.config.thermostats[ii].settemp);
									value1 = state1.val;
								} catch(e) {value1 = -99;}	
								adapter.setState(state+"savesettemp", {ack: true, val: value1});
							}
						}
					}

					adapter.log.info("no heat demand anymore for "+ hc + " --> switching off" );
					adapter.setState(adapter.config.heatingcircuits[i].state, {ack: false, val: vn});
				} else {					
					//adapter.log.info("heat demand manually set for "+ hc + " --> no action");
				}
			}
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




async function read_efficiency() {
	if (!unloaded) {
		let value = 0, power = 0,temp = 0,tempr = 0, tempavg = 0,state;

		if (adapter.config.emsesp_active && adapter.config.km200_structure){
			try {
				state = await adapter.getStateAsync("heatSources.hs1.curburnpow");power = state.val;
				state = await adapter.getStateAsync("heatSources.hs1.curflowtemp");temp = state.val;
				state = await adapter.getStateAsync("heatSources.hs1.rettemp");tempr = state.val;
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}
		if (adapter.config.emsesp_active && adapter.config.km200_structure === false){
			try {
				state = await adapter.getStateAsync("boiler.curburnpow");power = state.val;
				state = await adapter.getStateAsync("boiler.curflowtemp");temp = state.val;
				state = await adapter.getStateAsync("boiler.rettemp");tempr = state.val;
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}

		if (adapter.config.emsesp_active === false && adapter.config.km200_active){
			try {
				state = await adapter.getStateAsync("heatSources.hs1.actualModulation");power = state.val;
				state = await adapter.getStateAsync("heatSources.actualSupplyTemperature");temp = state.val;
				state = await adapter.getStateAsync("heatSources.returnTemperature");tempr = state.val;
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}

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
		adapter.setState("statistics.efficiency", {ack: true, val: value});
	}
}

async function read_efficiency1() {
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
				adapter.getState("heatSources.hs1.actualModulation", function (err, state) { if (state != null) power = state.val;});
				adapter.getState("heatSources.actualSupplyTemperature", function (err, state) {if (state != null) temp = state.val;});
				adapter.getState("heatSources.returnTemperature", function (err, state) {if (state != null) tempr = state.val;});
			}
			catch (err) {adapter.log.error("error read efficiency:"+err);}
		}

		adapter.log.info(power+ " "+temp+" "+tempr);

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

	for (const id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) await adapter.delObjectAsync(id);
	}
}
