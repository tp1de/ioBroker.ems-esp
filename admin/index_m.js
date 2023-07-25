/* eslint-disable no-undef */
/**
 * @license
 *
 */

//Settings

/**
 * This will be called by the admin adapter when the settings page loads
 * Dies wird vom Adapter Administrator aufgerufen, wenn die Einstellungsseite geladen wird
 * @param {object} settings - represents the adapter config object
 * @param {object} onChange - callback
 */


// This will be called by the admin adapter when the settings page loads
let roles = [];
let devices = [];
let thermostats = [];
let heatingcircuits = [];

/**
		function loadHelper(settings, onChange) {

			// example: select elements with id=key and class=value and insert value
			if (!settings) return;
			if (settings.electricityPollingInterval === undefined) settings.electricityPollingInterval = 20;
			$('.value').each(function () {
				var $key = $(this);
				var id = $key.attr('id');
				if (id === 'private_pw') {
					settings[id] = decrypt(secret, settings[id]);
				}
				if ($key.attr('type') === 'checkbox') {
					// do not call onChange direct, because onChange could expect some arguments
					$key.prop('checked', settings[id])
						.on('change', () => onChange());
				} else {
					// do not call onChange direct, because onChange could expect some arguments
					$key.val(settings[id])
						.on('change', () => onChange())
						.on('keyup', () => onChange());
				}
			});
			onChange(false);
			// reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
			if (M) M.updateTextFields();
			showHideSettings();
		}
		*/

function load(settings, onChange) {
	// example: select elements with id=key and class=value and insert value
	if (!settings) return;
	$(".tab-advanced").hide();

	$(".value").each(function () {
		const $key = $(this);
		const id = $key.attr("id");

		// check which type of html element
		// do not call onChange direct, because onChange could expect some arguments
		// Rufen Sie onChange nicht direkt auf, da onChange einige Argumente erwarten kann
		if ($key.attr("type") === "checkbox") {
			$key.prop("checked", settings[id])  // read setting value from adapter config object and set checkbox in config page => Lesen Sie den Einstellungswert aus dem Adapterkonfigurationsobjekt und setzen Sie das Kontrollkästchen auf der Konfigurationsseite
				.on("change", () => {
					showHideSettings();
					onChange(); // set listener to checkbox and call onChange if the value has changed => setze listener auf checkbox und rufe onChange auf, wenn sich der Wert geändert hat
				})
			;
		} else {
			$key.val(settings[id])
				.on("change", () => onChange())
				.on("keyup", () => onChange())
			;
		}
	});

	roles        	= settings.roles      		|| [];
	devices        	= settings.devices      	|| [];
	thermostats    	= settings.thermostats  	|| [];
	heatingcircuits	= settings.heatingcircuits 	|| [];

	onChange(false);
	values2table("roles", roles, onChange);
	values2table("devices", devices, onChange);
	values2table("thermostats", thermostats, onChange);
	values2table("heatingcircuits", heatingcircuits, onChange);
	// reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
	if (M) M.updateTextFields();
	showHideSettings();
}

// This will be called by the admin adapter when the user presses the save button
function save(callback) {
	// example: select elements with class=value and build settings object
	const obj = {};
	$(".value").each(function () {
		const $this = $(this);
		if ($this.attr("type") === "checkbox") {
			obj[$this.attr("id")] = $this.prop("checked");

		} else if ($this.attr("type") === "number") {
			obj[$this.attr("id")] = parseFloat($this.val());
		} else {
			obj[$this.attr("id")] = $this.val();
		}
	});
	obj.roles = table2values("roles");
	obj.devices = table2values("devices");
	obj.thermostats = table2values("thermostats");
	obj.heatingcircuits = table2values("heatingcircuits");
	callback(obj);
}

function showHideSettings(callback) {

	$("#emsesp_ip").on("change", function () {
		if ($(this).val().substr(0,3) === "***") {
			$(".tab-advanced").show();
		}
	}).trigger("change");

}
