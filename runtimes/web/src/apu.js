const DUTY_CYCLE_LENGTH = 0x800;
const NOISE_LENGTH = 0x8000;

// const NOISE_TABLE = [
//     447443.2 / 44100,
//     223721.6 / 44100,
//     111860.8 / 44100,
//     55930.4 / 44100,
//     27965.2 / 44100,
//     18643.5 / 44100,
//     13982.6 / 44100,
//     11186.1 / 44100,
//     8860.3 / 44100,
//     7046.3 / 44100,
//     4709.9 / 44100,
//     3523.2 / 44100,
//     2348.8 / 44100,
//     1761.6 / 44100,
//     879.9 / 44100,
//     440.0 / 44100,
// ].reverse();

export class APU {
    constructor () {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.ctx = ctx;

        this.nodes = new Array(4);

        function createDutyCycle (pulseWidth) {
            const real = new Float32Array(DUTY_CYCLE_LENGTH);
            for (let ii = 1; ii < DUTY_CYCLE_LENGTH; ii++) {
                real[ii] = 4 / (ii * Math.PI) * Math.sin(Math.PI * ii * pulseWidth);
            }
            return ctx.createPeriodicWave(real, new Float32Array(DUTY_CYCLE_LENGTH));
        }
        const duty25 = createDutyCycle(0.25);
        this.pulseDutyCycles = [
            createDutyCycle(0.125),
            duty25,
            createDutyCycle(0.5),
            duty25, // 75 is the same as 25
        ];

        const noiseBuffer = ctx.createBuffer(1, NOISE_LENGTH, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        let seed = 0x0001;
        for (let ii = 0; ii < NOISE_LENGTH; ++ii) {
            const bit0 = seed & 1;
            seed >>= 1;
            const bit1 = seed & 1;
            const feedback = (bit0 ^ bit1);
            seed |= feedback << 14;
            noiseData[ii] = feedback;
        }
        this.noiseBuffer = noiseBuffer;
    }

    tone (frequency, duration, volume, flags) {
        const freq1 = frequency & 0xffff;
        const freq2 = (frequency >> 16) & 0xffff;

        const sustain = (duration & 0xff) / 60;
        const release = ((duration >> 8) & 0xff) / 60;
        const decay = ((duration >> 16) & 0xff) / 60;
        const attack = ((duration >> 24) & 0xff) / 60;

        const channel = flags & 0x3;
        const mode = (flags >> 2) & 0x3;

        const ctx = this.ctx;
        const attackTime = ctx.currentTime + attack;
        const decayTime = attackTime + decay;
        const sustainTime = decayTime + sustain;
        const releaseTime = sustainTime + release;

        // Peak level of any channel should be -12 dB, or a quarter of full volume
        let peakLevel = 0.25;
        let sustainLevel = volume/100 * peakLevel;

        // Create gain node with ADSR ramp
        const gain = ctx.createGain();
        const gainValue = gain.gain;
        gainValue.setValueAtTime(0, 0);
        gainValue.linearRampToValueAtTime(peakLevel, attackTime);
        gainValue.linearRampToValueAtTime(sustainLevel, decayTime);
        gainValue.linearRampToValueAtTime(sustainLevel, sustainTime);
        gainValue.linearRampToValueAtTime(0, releaseTime);

        let node;
        if (channel == 3) {
            node = ctx.createBufferSource();
            node.buffer = this.noiseBuffer;
            node.loop = true;

            const pbrValue = node.playbackRate;
            pbrValue.setValueAtTime(freq1*freq1/1000000, 0);
            // pbrValue.value = NOISE_TABLE[16*(freq1/1024) | 0];
            if (freq2) {
                pbrValue.linearRampToValueAtTime(freq2*freq2/1000000, releaseTime);
            }

        } else {
            node = ctx.createOscillator();
            if (channel == 2) {
                node.type = "triangle";
            } else {
                const wave = this.pulseDutyCycles[mode];
                node.setPeriodicWave(wave);
            }

            const freqValue = node.frequency;
            freqValue.setValueAtTime(freq1, 0);
            if (freq2) {
                freqValue.linearRampToValueAtTime(freq2, releaseTime);
            }
        }

        const existingNode = this.nodes[channel];
        if (existingNode != null) {
            existingNode.stop(0);
        }
        this.nodes[channel] = node;

        node.start(0);
        node.stop(releaseTime);
        node.connect(gain);
        gain.connect(ctx.destination);
    }
}
