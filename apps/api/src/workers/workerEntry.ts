// Starts only the BullMQ workers, not the Express server
import { createEmailWorker } from './emailWorker';
import { createMagicLinkWorker } from './magicLinkWorker';

createEmailWorker();
createMagicLinkWorker();
console.log('Workers started');
