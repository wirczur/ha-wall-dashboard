import { log } from './log.js';
/** one per kiosk connection that has Assist on */
export class AssistSession {
    ha;
    cfg;
    emit;
    quiet;
    label;
    run = null;
    seq = 0;
    conversationId;
    lastTalk = 0;
    wake = false;
    wakeTimer;
    closed = false;
    constructor(ha, cfg, emit, quiet, label) {
        this.ha = ha;
        this.cfg = cfg;
        this.emit = emit;
        this.quiet = quiet;
        this.label = label;
    }
    /** conversation context lives for 5 minutes ("a teraz w kuchni") */
    conv() { if (Date.now() - this.lastTalk > 5 * 60_000)
        this.conversationId = undefined; return this.conversationId; }
    async text(text) {
        const t = text.trim().slice(0, 500);
        if (!t)
            return;
        this.stopRun();
        await this.start('text', { start_stage: 'intent', input: { text: t } });
    }
    async voice(on) {
        if (on) {
            this.stopRun();
            await this.start('ptt', { start_stage: 'stt', input: { sample_rate: 16000 } });
        }
        else
            this.endAudio();
    }
    setWake(on) {
        this.wake = on;
        clearTimeout(this.wakeTimer);
        if (on && !this.run)
            this.startWake();
        if (!on && this.run?.mode === 'wake' && !this.run.wakeHeard)
            this.stopRun();
    }
    /** 16 kHz s16le mono from the panel */
    audio(chunk) {
        const r = this.run;
        if (!r || r.ended || r.mode === 'text')
            return;
        if (r.handler == null) {
            if (r.queue.length < 50)
                r.queue.push(chunk);
            return;
        }
        this.ha.sendBinary(Buffer.concat([Buffer.from([r.handler]), chunk]));
    }
    /** "Nowa rozmowa" on the panel */
    reset() { this.conversationId = undefined; this.lastTalk = 0; if (this.run && this.run.mode !== 'wake')
        this.stopRun(); }
    close() { this.closed = true; this.wake = false; clearTimeout(this.wakeTimer); this.stopRun(); }
    startWake() {
        if (this.closed || !this.wake)
            return;
        if (this.quiet() && !this.cfg()?.wakeInQuiet) {
            this.wakeTimer = setTimeout(() => this.startWake(), 30_000);
            return;
        } // paused at night
        this.start('wake', { start_stage: 'wake_word', input: { sample_rate: 16000, timeout: 3600 } }).catch(() => { });
    }
    endAudio() {
        const r = this.run;
        if (r && r.handler != null && !r.ended)
            this.ha.sendBinary(Buffer.from([r.handler]));
    }
    stopRun() {
        const r = this.run;
        if (!r)
            return;
        r.ended = true;
        this.endAudio();
        if (r.sub != null)
            this.ha.dropSub(r.sub);
        this.run = null;
    }
    async start(mode, body) {
        const cfg = this.cfg();
        if (!cfg?.enabled) {
            this.emit({ ev: 'error', text: 'Asystent jest wyłączony dla tego tabletu' });
            return;
        }
        const r = { n: ++this.seq, mode, ended: false, queue: [] };
        this.run = r;
        const tts = !!cfg.tts && !this.quiet();
        const msg = {
            type: 'assist_pipeline/run', ...body, end_stage: tts ? 'tts' : 'intent',
            ...(cfg.pipeline ? { pipeline: cfg.pipeline } : {}),
            ...(this.conv() ? { conversation_id: this.conversationId } : {})
        };
        try {
            r.sub = await this.ha.subscribe(msg, (ev) => this.onEvent(r, ev));
        }
        catch (e) {
            if (this.run === r)
                this.run = null;
            this.emit({ ev: 'error', run: r.n, text: e.message });
            if (mode === 'wake')
                this.wakeTimer = setTimeout(() => this.startWake(), 15_000);
        }
    }
    onEvent(r, ev) {
        if (r !== this.run && r.mode !== 'text')
            return;
        const d = ev?.data ?? {};
        switch (ev?.type) {
            case 'run-start': {
                const h = d.runner_data?.stt_binary_handler_id;
                if (h != null) {
                    r.handler = h;
                    for (const q of r.queue.splice(0))
                        this.audio(q);
                }
                if (r.mode === 'ptt')
                    this.emit({ ev: 'listening', run: r.n });
                if (r.mode === 'wake')
                    this.emit({ ev: 'ready', run: r.n });
                break;
            }
            case 'wake_word-end':
                if (d.wake_word_output && Object.keys(d.wake_word_output).length) {
                    r.wakeHeard = true;
                    this.emit({ ev: 'wake', run: r.n });
                    this.emit({ ev: 'listening', run: r.n });
                }
                break;
            case 'stt-end': {
                const text = d.stt_output?.text;
                if (text)
                    this.emit({ ev: 'stt', run: r.n, text });
                break;
            }
            case 'intent-end': {
                const out = d.intent_output ?? {};
                if (out.conversation_id)
                    this.conversationId = out.conversation_id;
                this.lastTalk = Date.now();
                const speech = out.response?.speech?.plain?.speech ?? '';
                this.emit({ ev: 'reply', run: r.n, text: speech || 'Gotowe.', conversationId: this.conversationId });
                log.info(`Asystent (${this.label}): ${speech.slice(0, 120)}`);
                break;
            }
            case 'tts-end': {
                const url = String(d.tts_output?.url ?? '');
                const file = /\/api\/tts_proxy\/([\w.-]+)$/.exec(url.split('?')[0])?.[1];
                if (file && !this.quiet())
                    this.emit({ ev: 'tts', run: r.n, url: 'api/assist/tts/' + file });
                break;
            }
            case 'error': {
                const code = String(d.code ?? '');
                // nothing said / wake word timeout – not worth an error on the wall
                const quietErr = ['stt-no-text-recognized', 'wake-word-timeout', 'stt-stream-failed'].includes(code) || (r.mode === 'wake' && !r.wakeHeard);
                this.emit({ ev: 'error', run: r.n, code, text: quietErr ? '' : d.message || code });
                break;
            }
            case 'run-end':
                r.ended = true;
                if (r.sub != null)
                    this.ha.dropSub(r.sub);
                if (this.run === r)
                    this.run = null;
                this.emit({ ev: 'end', run: r.n });
                if (this.wake)
                    this.wakeTimer = setTimeout(() => this.startWake(), r.mode === 'wake' && !r.wakeHeard ? 1500 : 400);
                break;
        }
    }
}
