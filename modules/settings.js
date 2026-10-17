import fs from "fs";
import { loadConfig, saveConfig, config_path } from "./config.js";
import { getDisks, chooseDownloadDrive } from "./getDisks.js";
import { promptWithDefault, promptHidden, promptYesNo } from "./readlineInterface.js";

/**
 * Ask for everything the script needs up front, offering saved answers from config.json
 * as defaults, then offer to save the answers for next time.
 * @param bool needs_destination Whether to ask where to save downloads.
 * @returns Promise<object> {headless, drive, folder, destination_path, email, password, saveCredentials}
 */
export async function askSettings(needs_destination){
	const config = loadConfig();
	const has_config = Object.keys(config).length > 0;
	if(has_config) console.log(`Using saved answers from ${config_path} as defaults. Press Enter to keep them.\n`);

	const settings = {};
	settings.headless = await promptYesNo('Run the browser hidden (headless)?', config.headless ?? false);

	if(needs_destination){
		const disks = await getDisks();
		settings.drive = await chooseDownloadDrive(disks, config.drive);
		if(settings.drive === false){
			console.log('Invalid selection');
			process.exit();
		}

		settings.folder = await promptWithDefault('Enter the path to the folder you want to save files to', config.folder);
		settings.destination_path = `${settings.drive}/${settings.folder}`.replaceAll('//', '/');
		if(!fs.existsSync(settings.destination_path) || !fs.lstatSync(settings.destination_path).isDirectory()){
			console.log(`Path (${settings.destination_path}) either does not exist or is not a directory.`);
			process.exit();
		}
	}

	const credentials = await askCredentials(config);
	settings.email = credentials.email;
	settings.password = credentials.password;

	// Only offer to save if something is different from what's already saved.
	const answers = {
		headless: settings.headless,
		...(needs_destination ? {drive: settings.drive, folder: settings.folder} : {}),
		email: settings.email,
	};
	const changed = Object.entries(answers).some(([k, v])=>config[k] !== v)
		|| (config.password !== undefined && config.password !== settings.password);
	let password_saved = config.password !== undefined && config.password === settings.password;

	if(changed || !has_config){
		if(await promptYesNo(`Save these choices to config.json for next time?`, has_config)){
			const save_password = await promptYesNo('Also save your password? It will be stored as plain text.', config.password !== undefined);
			const new_config = {...config, ...answers};
			if(save_password) new_config.password = settings.password;
			else delete new_config.password;
			saveConfig(new_config);
			password_saved = save_password;
			console.log(`Saved to ${config_path}`);
		}
	}
	console.log('');

	// If the saved login turns out to be wrong, call this with the new one to keep config.json up to date.
	settings.saveCredentials = ({email, password})=>{
		if(!password_saved) return;
		saveConfig({...loadConfig(), email, password});
	};

	return settings;
}

/**
 * Ask for the iCloud email and password, defaulting to the saved ones.
 * @param object config Saved config, or {} to ask with no defaults.
 * @returns Promise<{email, password}>
 */
export async function askCredentials(config = {}){
	let email = '';
	while(!email) email = await promptWithDefault('Enter your iCloud email', config.email);

	const has_saved_password = !!config.password && email === config.email;
	let password = '';
	while(!password){
		password = await promptHidden('Enter your iCloud password', has_saved_password);
		if(!password && has_saved_password) password = config.password;
	}
	return {email, password};
}
