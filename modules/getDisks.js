import {exec} from 'node:child_process';
import { prompt } from "./readlineInterface.js";

export async function getDisks(){
	return new Promise((resolve, reject)=>{
		exec('diskutil list -plist physical', function(err, stdout, stderr) {
			if (err) {
				reject(err);
				return;
			}
			const drives = [];
			const matches = stdout.matchAll(/<key>MountPoint<\/key>\n\s+<string>([^<]+)<\/string>/gm);
			for (const match of matches) {
				drives.push(match[1]);
			}
			resolve(drives);
		})
	});
}


/**
 * Ask which drive to save to. If default_drive is one of the options, pressing Enter picks it.
 * @returns Promise<string|false> The drive's mount point, or false for an invalid choice.
 */
export async function chooseDownloadDrive(disks, default_drive){
	const options = ['/', ...disks];
	console.log("Where would you like to download content to?");
	console.log(`\t1) Internal hard drive (/)`);
	for(let i=0; i<disks.length; i++){
		console.log(`\t${i+2}) ${disks[i]}`);
	}
	if(default_drive && !options.includes(default_drive)){
		console.log(`(Your saved drive ${default_drive} isn't connected.)`);
	}
	const default_index = options.indexOf(default_drive);
	const hint = default_index >= 0 ? ` [${default_index+1}]` : '';
	const answer = (await prompt(`Enter a number${hint}: `)).trim();
	const n = answer === '' && default_index >= 0 ? default_index+1 : parseInt(answer);
	if(!(n >= 1 && n <= options.length)){
		return false;
	}
	return options[n-1];
}
