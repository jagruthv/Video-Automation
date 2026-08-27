/**
 * AURA-V2 Titanium: Async Pipeline Queue Manager
 * 
 * Handles multi-phase execution with specific concurrency limits
 * and backpressure to prevent CPU/RAM overload during rendering.
 */
const eventBus = require('./modules/event-bus');

class QueueManager {
    constructor() {
        this.queues = {
            fast: { name: 'BRAIN_AUDIO', limit: 3, active: 0, waiting: [] },
            heavy: { name: 'VISION_ASSEMBLE', limit: 1, active: 0, waiting: [] },
        };
        this.MAX_HEAVY_QUEUE = 10;
        this.isFastPaused = false;
    }

    _checkBackpressure() {
        const heavyQueueLen = this.queues.heavy.waiting.length;
        if (heavyQueueLen >= this.MAX_HEAVY_QUEUE && !this.isFastPaused) {
            console.log(`[QUEUE_MANAGER] ⚠️ BACKPRESSURE REACHED: Heavy queue at ${heavyQueueLen}. Halting Fast Lane.`);
            eventBus.emit('log', `[QUEUE_MANAGER] ⚠️ Backpressure limit reached (${heavyQueueLen}). Halting Phase 1/2.`);
            this.isFastPaused = true;
        } else if (heavyQueueLen < this.MAX_HEAVY_QUEUE && this.isFastPaused) {
            console.log(`[QUEUE_MANAGER] 🟢 BACKPRESSURE CLEARED: Heavy queue at ${heavyQueueLen}. Re-engaging Fast Lane.`);
            eventBus.emit('log', `[QUEUE_MANAGER] 🟢 Backpressure cleared. Re-engaging Phase 1/2.`);
            this.isFastPaused = false;
            this._pump('fast'); // Resume waiting
        }
    }

    _pump(lane) {
        const q = this.queues[lane];
        
        // Block the fast lane if backpressure is engaged
        if (lane === 'fast' && this.isFastPaused) return;

        while (q.active < q.limit && q.waiting.length > 0) {
            const task = q.waiting.shift();
            q.active++;
            
            this._checkBackpressure(); // Re-evaluate backpressure since we moved an item

            // Execute the promise-returning task
            task()
                .then(() => {
                    q.active--;
                    this._pump(lane);
                    if (lane === 'heavy') this._checkBackpressure(); // Heavy finished, might release backpressure
                })
                .catch((err) => {
                    console.error(`[QUEUE_MANAGER] ❌ Task Error in Lane ${lane}:`, err.message);
                    q.active--;
                    this._pump(lane);
                    if (lane === 'heavy') this._checkBackpressure();
                });
        }
    }

    /**
     * Enqueue a Phase 1/2 task (Script Generation, Audio, Guard Validation)
     */
    enqueueFast(taskFn) {
        return new Promise((resolve, reject) => {
            this.queues.fast.waiting.push(() => taskFn().then(resolve).catch(reject));
            this._pump('fast');
        });
    }

    /**
     * Enqueue a Phase 3/4 task (Visuals, FFMPEG Assembly)
     */
    enqueueHeavy(taskFn) {
        return new Promise((resolve, reject) => {
            this.queues.heavy.waiting.push(() => taskFn().then(resolve).catch(reject));
            this._checkBackpressure();
            this._pump('heavy');
        });
    }
    
    getStats() {
        return {
            fastQueue: this.queues.fast.waiting.length,
            fastActive: this.queues.fast.active,
            heavyQueue: this.queues.heavy.waiting.length,
            heavyActive: this.queues.heavy.active,
            backpressure: this.isFastPaused
        };
    }
}

module.exports = new QueueManager();
