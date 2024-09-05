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


export async function chooseDownloadDrive(disks){
	console.log("Where would you like to download content to?");
	console.log(`\t1) Internal hard drive (/)`);
	for(let i=0; i<disks.length; i++){
		console.log(`\t${i+2}) ${disks[i]}`);
	}
	let n = parseInt(await prompt('Enter a number: '));
	if(n >= disks.length+2){
		return false;
	}
	if(n === 1) return '/';
	return disks[n-2];
}