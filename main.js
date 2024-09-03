import puppeteer from 'puppeteer';
import { iCloudLogin } from './iCloudLogin.js';

const browser = await puppeteer.launch({headless: false});
const page = await browser.newPage();

let login_success = await iCloudLogin(page);

console.log(login_success ? "Success" : "Error");
process.exit();