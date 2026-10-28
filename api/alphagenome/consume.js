import {QueueClient} from '@vercel/queue';
import {processJob} from '../../server/alphaGenomeCloud.js';
const queue=new QueueClient();
export default queue.handleNodeCallback(processJob,{visibilityTimeoutSeconds:300,retry:(error,metadata)=>metadata.deliveryCount>=2?{acknowledge:true}:{afterSeconds:20}});
