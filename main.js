import puppeteer from 'puppeteer';
import { iCloudLogin } from './iCloudLogin.js';
import {getDisks, chooseDownloadDrive} from './getDisks.js';


let disks = await getDisks();
let location = await chooseDownloadDrive(disks);
if(location === false){
	console.log('Invalid selection');
	process.exit();
}



// const browser = await puppeteer.launch({headless: false});
// const page = await browser.newPage();

// let login_success = await iCloudLogin(page);

// if(!login_success){
// 	console.log('Unable to login.');
// 	process.exit();
// }

// console.log('Login success!');

// // Open the photos page
// await page.goto('https://www.icloud.com/photos/');

// // Get the reference to the frame
// const frame_handle = await page.waitForSelector('iframe.child-application');
// const frame = await frame_handle.contentFrame();

// // Get the box that contains all the images and scroll it to the top
// await frame.waitForSelector('.grid-scroll');
// await frame.evaluate(()=>{
// 	document.querySelector('.grid-scroll').scrollTo(0, 0);
// });

// // Click on the first thing to select it
// await frame.click('.grid-item:nth-of-type(1)');
