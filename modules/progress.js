import readline from 'node:readline';

const spinner_frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const bar_width = 30;

function formatDuration(ms){
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if(h) return `${h}h ${m}m`;
	if(m) return `${m}m ${s % 60}s`;
	return `${s}s`;
}

/**
 * A status display pinned to the bottom of the terminal: a progress bar (once there's a total)
 * and the step the script is on. Messages logged with log() are printed above it.
 */
export class Progress {
	constructor(){
		this.tty = !!process.stdout.isTTY;
		this.total = 0;
		this.done = 0;
		this.files = 0;
		this.skipped = 0;
		this.step = '';
		this.detail = '';
		this.started = null;
		this.lines_drawn = 0;
		this.frame = 0;
		this.timer = null;
	}

	/** Start (or resume) drawing the status display. */
	start(){
		if(!this.tty || this.timer) return;
		this.timer = setInterval(()=>{ this.frame++; this.render(); }, 100);
		this.timer.unref();
	}

	/** Erase the status display and stop redrawing it, e.g. before asking a question. */
	stop(){
		if(this.timer){ clearInterval(this.timer); this.timer = null; }
		this.clear();
	}

	setTotal(total){
		this.total = total;
		this.started = Date.now();
		this.render();
	}

	/** Set the current step, e.g. "Downloading batch 3". detail is extra info that changes often. */
	setStep(step, detail = ''){
		const changed = step !== this.step;
		this.step = step;
		this.detail = detail;
		if(!this.tty && changed) console.log(`- ${step}`);
		this.render();
	}

	setDetail(detail){
		this.detail = detail;
		this.render();
	}

	addDone(n){ this.done += n; this.render(); }
	addFile(){ this.files++; }
	addSkipped(){ this.skipped++; }

	/** Print a message above the status display. */
	log(message){
		this.clear();
		console.log(message);
		this.render();
	}

	clear(){
		if(!this.tty || !this.lines_drawn) return;
		readline.moveCursor(process.stdout, 0, -(this.lines_drawn - 1));
		readline.cursorTo(process.stdout, 0);
		readline.clearScreenDown(process.stdout);
		this.lines_drawn = 0;
	}

	render(){
		if(!this.tty || !this.timer) return;
		const width = Math.max((process.stdout.columns || 80) - 1, 20);
		// Truncate so lines never wrap, otherwise clearing the display misses a line.
		const fit = s => s.length > width ? s.slice(0, width - 1) + '…' : s;

		const lines = [];
		if(this.total){
			const ratio = Math.min(this.done / this.total, 1);
			const filled = Math.round(ratio * bar_width);
			const bar = '█'.repeat(filled) + '░'.repeat(bar_width - filled);
			const elapsed = Date.now() - this.started;
			const eta = this.done ? formatDuration(elapsed / this.done * (this.total - this.done)) : '--';
			lines.push(fit(` ${bar} ${(ratio * 100).toFixed(1).padStart(5)}%  ${this.done.toLocaleString()} / ${this.total.toLocaleString()} items  ·  ${this.files.toLocaleString()} files saved${this.skipped ? ` (${this.skipped.toLocaleString()} duplicates skipped)` : ''}  ·  ${formatDuration(elapsed)} elapsed  ·  ETA ${eta}`));
		}else if(this.started){
			// Total unknown, so there's nothing to fill a bar against.
			lines.push(fit(` ${this.done.toLocaleString()} items  ·  ${this.files.toLocaleString()} files saved${this.skipped ? ` (${this.skipped.toLocaleString()} duplicates skipped)` : ''}  ·  ${formatDuration(Date.now() - this.started)} elapsed`));
		}
		const spinner = spinner_frames[this.frame % spinner_frames.length];
		lines.push(fit(` ${spinner} ${this.step}${this.detail ? `: ${this.detail}` : ''}`));

		this.clear();
		process.stdout.write(lines.join('\n'));
		this.lines_drawn = lines.length;
	}
}

export const progress = new Progress();
