import { sleep } from "./sleep.js";

export function waitForDownload(browser, page, callback) {
	return new Promise(async (resolve)=>{

		const dmPage = await browser.newPage();
		await dmPage.goto("chrome://downloads/");
		await dmPage.bringToFront();
		await sleep(500);

		let tries = 0;
		const getStatus = async ()=>{
			
			let status = await dmPage.evaluate(async ()=>{
				if(!document.querySelector("downloads-manager")){
					return '-';
				}else{
					return document
						?.querySelector("downloads-manager")
						?.shadowRoot?.querySelector("#frb0")
						?.shadowRoot?.querySelector('.description')?.innerText?.trim();
				}
			});

			if(status === '-'){
				await sleep(100);
				getStatus();
			}else if(status){
				tries = 101;
				callback(status);
				await sleep(100);
				getStatus();
			}else{
				if(tries < 100){
					tries++;
					await sleep(100);
					getStatus();
				}else{
					await dmPage.close();
					await page.bringToFront();
					resolve();
				}
			}
		};
		
		getStatus();
		
	});
}