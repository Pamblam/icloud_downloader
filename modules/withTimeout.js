export const withTimeout = (promise, timeout) => Promise.race([
	promise,
	new Promise((resolve, reject)=>setTimeout(()=>reject(new Error(`Timed out after ${timeout}ms`)), timeout))
]);
