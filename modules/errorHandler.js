import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { progress } from "./progress.js";
import { withTimeout } from "./withTimeout.js";

export const debug_dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'debug');

let browser = null;

/** Once the browser is running, errors will also screenshot every open tab. */
export const setBrowserForErrors = b=>{ browser = b; };

/**
 * Print any uncaught error on its own line (not after the status display), save a screenshot of
 * every open browser tab to debug/, then exit.
 */
export function handleErrors(){
	let handling = false;
	const handler = async e=>{
		if(handling) return;
		handling = true;
		progress.stop();
		console.error(e);
		if(browser){
			try{
				const saved = await withTimeout(saveScreenshots(browser), 30000);
				if(saved.length) console.error(`\nScreenshots of the browser when this happened:\n${saved.map(s=>`  ${s}`).join('\n')}`);
			}catch(err){
				console.error(`\nCouldn't save a screenshot: ${err.message}`);
			}
		}
		process.exit(1);
	};
	process.on('uncaughtException', handler);
	process.on('unhandledRejection', handler);
}

/**
 * @returns Promise<string[]> "path (url)" for each screenshot saved.
 */
async function saveScreenshots(browser){
	fs.mkdirSync(debug_dir, {recursive: true});
	const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '');
	const pages = await browser.pages();
	const saved = [];
	for(let i=0; i<pages.length; i++){
		const url = pages[i].url();
		if(url === 'about:blank') continue;
		const file = path.join(debug_dir, `${stamp}-tab${i+1}.png`);
		try{
			// A screenshot of a hung or background tab can stall, so don't let one block the rest.
			await withTimeout(pages[i].screenshot({path: file}), 10000);
			saved.push(`${file} (${url})`);
		}catch(e){}
	}
	return saved;
}
