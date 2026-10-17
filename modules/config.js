import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Lives next to main.js so it's found no matter which directory the script is run from.
export const config_path = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');

/**
 * @returns object The saved config, or {} if there isn't one (or it can't be read).
 */
export function loadConfig(){
	if(!fs.existsSync(config_path)) return {};
	try{
		return JSON.parse(fs.readFileSync(config_path, 'utf8'));
	}catch(e){
		console.log(`Couldn't read ${config_path} (${e.message}), ignoring it.`);
		return {};
	}
}

/**
 * Write the config, readable only by the current user since it may hold a password.
 * @param object config
 */
export function saveConfig(config){
	fs.writeFileSync(config_path, JSON.stringify(config, null, '\t') + '\n', {mode: 0o600});
	fs.chmodSync(config_path, 0o600);
}
